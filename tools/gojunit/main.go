// Command gojunit turns `go test -json` output into a run directory's
// results.xml (JUnit) and summary.md, and exits non-zero if a test failed.
//
//	go test -json ./... | gojunit <run directory>
package main

import (
	"bufio"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type event struct {
	Action  string
	Package string
	Test    string
	Elapsed float64
	Output  string
}

type result struct {
	pkg, name, status string
	elapsed           float64
	output            strings.Builder
}

type testcase struct {
	Name      string    `xml:"name,attr"`
	Classname string    `xml:"classname,attr"`
	Time      string    `xml:"time,attr"`
	Failure   *failure  `xml:"failure,omitempty"`
	Skipped   *struct{} `xml:"skipped,omitempty"`
}

type failure struct {
	Message string `xml:"message,attr"`
	Text    string `xml:",chardata"`
}

type suite struct {
	Name     string     `xml:"name,attr"`
	Tests    int        `xml:"tests,attr"`
	Failures int        `xml:"failures,attr"`
	Errors   int        `xml:"errors,attr"`
	Skipped  int        `xml:"skipped,attr"`
	Time     string     `xml:"time,attr"`
	Cases    []testcase `xml:"testcase"`
}

type suites struct {
	XMLName  xml.Name `xml:"testsuites"`
	Tests    int      `xml:"tests,attr"`
	Failures int      `xml:"failures,attr"`
	Errors   int      `xml:"errors,attr"`
	Skipped  int      `xml:"skipped,attr"`
	Suites   []suite  `xml:"testsuite"`
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: go test -json ./... | gojunit <run directory>")
		os.Exit(2)
	}
	dir := os.Args[1]
	results := map[string]*result{}
	var order []string
	pkgFailed := map[string]bool{}
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	for sc.Scan() {
		var e event
		if json.Unmarshal(sc.Bytes(), &e) != nil {
			continue
		}
		if e.Test == "" {
			if e.Action == "fail" {
				pkgFailed[e.Package] = true
			}
			continue
		}
		key := e.Package + "\x00" + e.Test
		r, ok := results[key]
		if !ok {
			r = &result{pkg: e.Package, name: e.Test}
			results[key] = r
			order = append(order, key)
		}
		switch e.Action {
		case "output":
			r.output.WriteString(e.Output)
		case "pass", "fail", "skip":
			r.status, r.elapsed = e.Action, e.Elapsed
		}
	}
	all := suites{}
	byPkg := map[string]*suite{}
	var pkgs []string
	for _, key := range order {
		r := results[key]
		if strings.Contains(r.name, "/") {
			continue // subtests are reported through their parent
		}
		s, ok := byPkg[r.pkg]
		if !ok {
			s = &suite{Name: r.pkg}
			byPkg[r.pkg] = s
			pkgs = append(pkgs, r.pkg)
		}
		tc := testcase{Name: r.name, Classname: r.pkg, Time: fmt.Sprintf("%.3f", r.elapsed)}
		switch r.status {
		case "fail", "":
			tc.Failure = &failure{Message: "failed", Text: r.output.String()}
			s.Failures++
		case "skip":
			tc.Skipped = &struct{}{}
			s.Skipped++
		}
		s.Tests++
		s.Cases = append(s.Cases, tc)
	}
	for _, p := range pkgs {
		s := byPkg[p]
		all.Suites = append(all.Suites, *s)
		all.Tests += s.Tests
		all.Failures += s.Failures
		all.Skipped += s.Skipped
	}
	for p := range pkgFailed {
		if _, ok := byPkg[p]; !ok {
			all.Errors++
			all.Suites = append(all.Suites, suite{Name: p, Errors: 1})
		}
	}
	os.MkdirAll(dir, 0o755)
	raw, _ := xml.MarshalIndent(all, "", "  ")
	os.WriteFile(filepath.Join(dir, "results.xml"), append([]byte(xml.Header), raw...), 0o644)
	writeSummary(dir, all)
	if all.Failures+all.Errors > 0 {
		os.Exit(1)
	}
}

func writeSummary(dir string, all suites) {
	var b strings.Builder
	result := "passed"
	if all.Failures+all.Errors > 0 {
		result = "failed"
	}
	fmt.Fprintf(&b, "## Test run %s\n\n", filepath.Base(dir))
	fmt.Fprintf(&b, "**%s**: %d tests, %d failed, %d skipped, %d package errors. %s\n\n",
		result, all.Tests, all.Failures, all.Skipped, all.Errors, time.Now().UTC().Format(time.RFC3339))
	b.WriteString("| Test | Package | Result | Time |\n|---|---|---|---|\n")
	var rows []string
	for _, s := range all.Suites {
		for _, c := range s.Cases {
			status := "pass"
			if c.Failure != nil {
				status = "**FAIL**"
			} else if c.Skipped != nil {
				status = "skip"
			}
			pkg := s.Name[strings.LastIndex(s.Name, "/")+1:]
			rows = append(rows, fmt.Sprintf("| %s | %s | %s | %ss |", c.Name, pkg, status, c.Time))
		}
	}
	// Security tests first, as in the plan.
	sort.SliceStable(rows, func(i, j int) bool {
		return strings.Contains(rows[i], "TestSec") && !strings.Contains(rows[j], "TestSec")
	})
	b.WriteString(strings.Join(rows, "\n") + "\n")
	os.WriteFile(filepath.Join(dir, "summary.md"), []byte(b.String()), 0o644)
}
