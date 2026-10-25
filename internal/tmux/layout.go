package tmux

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// A window layout as tmux writes it: "b25d,100x30,0,0{50x30,0,0,3,49x30,51,0,4}"
// is a checksum, then cells of "WxH,X,Y" that are a pane (",id") or a
// split with children in {...} (side by side) or [...] (stacked). When
// a window changes size, tmux resizes the cells without keeping their
// proportions; ScaleLayout keeps them, so a window fitted to a browser
// looks like the one at the host.

type layoutCell struct {
	w, h, x, y int
	id         int  // pane id number, for a pane
	kind       byte // 0 pane, '{' side by side, '[' stacked
	children   []*layoutCell
}

type layoutParser struct {
	s string
	i int
}

func (p *layoutParser) number() (int, error) {
	start := p.i
	for p.i < len(p.s) && p.s[p.i] >= '0' && p.s[p.i] <= '9' {
		p.i++
	}
	if start == p.i {
		return 0, fmt.Errorf("layout: number expected at %d", start)
	}
	return strconv.Atoi(p.s[start:p.i])
}

func (p *layoutParser) take(c byte) error {
	if p.i >= len(p.s) || p.s[p.i] != c {
		return fmt.Errorf("layout: %q expected at %d", c, p.i)
	}
	p.i++
	return nil
}

func (p *layoutParser) cell() (*layoutCell, error) {
	c := &layoutCell{}
	var err error
	if c.w, err = p.number(); err != nil {
		return nil, err
	}
	if err = p.take('x'); err != nil {
		return nil, err
	}
	if c.h, err = p.number(); err != nil {
		return nil, err
	}
	if err = p.take(','); err != nil {
		return nil, err
	}
	if c.x, err = p.number(); err != nil {
		return nil, err
	}
	if err = p.take(','); err != nil {
		return nil, err
	}
	if c.y, err = p.number(); err != nil {
		return nil, err
	}
	if p.i < len(p.s) && (p.s[p.i] == '{' || p.s[p.i] == '[') {
		c.kind = p.s[p.i]
		closer := byte('}')
		if c.kind == '[' {
			closer = ']'
		}
		p.i++
		for {
			child, err := p.cell()
			if err != nil {
				return nil, err
			}
			c.children = append(c.children, child)
			if p.i < len(p.s) && p.s[p.i] == ',' {
				p.i++
				continue
			}
			break
		}
		if err = p.take(closer); err != nil {
			return nil, err
		}
		if len(c.children) < 2 {
			return nil, fmt.Errorf("layout: a split with one child")
		}
		return c, nil
	}
	if err = p.take(','); err != nil {
		return nil, err
	}
	if c.id, err = p.number(); err != nil {
		return nil, err
	}
	return c, nil
}

func parseLayout(layout string) (*layoutCell, error) {
	comma := strings.IndexByte(layout, ',')
	if comma != 4 {
		return nil, fmt.Errorf("layout: no checksum")
	}
	p := &layoutParser{s: layout[comma+1:]}
	root, err := p.cell()
	if err != nil {
		return nil, err
	}
	if p.i != len(p.s) {
		return nil, fmt.Errorf("layout: trailing characters")
	}
	return root, nil
}

// layoutChecksum is tmux's: a rotating 16-bit sum over the layout body.
func layoutChecksum(body string) uint16 {
	var csum uint16
	for i := 0; i < len(body); i++ {
		csum = (csum >> 1) + ((csum & 1) << 15)
		csum += uint16(body[i])
	}
	return csum
}

func (c *layoutCell) write(b *strings.Builder) {
	fmt.Fprintf(b, "%dx%d,%d,%d", c.w, c.h, c.x, c.y)
	if c.kind == 0 {
		fmt.Fprintf(b, ",%d", c.id)
		return
	}
	b.WriteByte(c.kind)
	for i, child := range c.children {
		if i > 0 {
			b.WriteByte(',')
		}
		child.write(b)
	}
	if c.kind == '{' {
		b.WriteByte('}')
	} else {
		b.WriteByte(']')
	}
}

func (c *layoutCell) String() string {
	var b strings.Builder
	c.write(&b)
	body := b.String()
	return fmt.Sprintf("%04x,%s", layoutChecksum(body), body)
}

// share splits total among parts in proportion to weights, every part at
// least one, the remainder to the largest fractions first.
func share(weights []int, total int) ([]int, error) {
	n := len(weights)
	if total < n {
		return nil, fmt.Errorf("layout: %d cells do not fit in %d", n, total)
	}
	sum := 0
	for _, w := range weights {
		sum += w
	}
	if sum == 0 {
		sum = 1
	}
	out := make([]int, n)
	type rest struct {
		i    int
		frac float64
	}
	rests := make([]rest, n)
	given := 0
	for i, w := range weights {
		exact := float64(w) * float64(total) / float64(sum)
		out[i] = int(exact)
		if out[i] < 1 {
			out[i] = 1
		}
		rests[i] = rest{i, exact - float64(int(exact))}
		given += out[i]
	}
	sort.SliceStable(rests, func(a, b int) bool { return rests[a].frac > rests[b].frac })
	for k := 0; given < total; k = (k + 1) % n {
		out[rests[k].i]++
		given++
	}
	for k := 0; given > total; k = (k + 1) % n {
		if out[rests[n-1-k].i] > 1 {
			out[rests[n-1-k].i]--
			given--
		}
	}
	return out, nil
}

// scale sets the cell to w×h at x,y and lays its children out inside in
// their old proportions, one line or column between neighbours.
func (c *layoutCell) scale(w, h, x, y int) error {
	c.w, c.h, c.x, c.y = w, h, x, y
	if c.kind == 0 {
		return nil
	}
	n := len(c.children)
	weights := make([]int, n)
	for i, child := range c.children {
		if c.kind == '{' {
			weights[i] = child.w
		} else {
			weights[i] = child.h
		}
	}
	total := h - (n - 1)
	if c.kind == '{' {
		total = w - (n - 1)
	}
	sizes, err := share(weights, total)
	if err != nil {
		return err
	}
	at := 0
	for i, child := range c.children {
		if c.kind == '{' {
			err = child.scale(sizes[i], h, x+at, y)
		} else {
			err = child.scale(w, sizes[i], x, y+at)
		}
		if err != nil {
			return err
		}
		at += sizes[i] + 1
	}
	return nil
}

// LayoutPanes lists the pane ids a layout names, as "%<n>", sorted.
func LayoutPanes(layout string) ([]string, error) {
	root, err := parseLayout(layout)
	if err != nil {
		return nil, err
	}
	var ids []string
	var walk func(c *layoutCell)
	walk = func(c *layoutCell) {
		if c.kind == 0 {
			ids = append(ids, "%"+strconv.Itoa(c.id))
			return
		}
		for _, child := range c.children {
			walk(child)
		}
	}
	walk(root)
	sort.Strings(ids)
	return ids, nil
}

// ScaleLayout is the layout at w×h with every split in its old proportions.
func ScaleLayout(layout string, w, h int) (string, error) {
	root, err := parseLayout(layout)
	if err != nil {
		return "", err
	}
	if err := root.scale(w, h, 0, 0); err != nil {
		return "", err
	}
	return root.String(), nil
}

// layoutOrder is the layout's pane ids, as "%<n>", in the order tmux fills
// its places: depth first.
func layoutOrder(root *layoutCell) []string {
	if root.kind == 0 {
		return []string{"%" + strconv.Itoa(root.id)}
	}
	var ids []string
	for _, child := range root.children {
		ids = append(ids, layoutOrder(child)...)
	}
	return ids
}

func sameShape(a, b *layoutCell) bool {
	if a.kind != b.kind || len(a.children) != len(b.children) {
		return false
	}
	if a.kind == 0 {
		return a.id == b.id
	}
	for i := range a.children {
		if !sameShape(a.children[i], b.children[i]) {
			return false
		}
	}
	return true
}

// SameShape is whether two layouts have the same splits with the same panes
// in the same places, sizes aside. A layout that does not parse has no shape.
func SameShape(a, b string) bool {
	ra, err := parseLayout(a)
	if err != nil {
		return false
	}
	rb, err := parseLayout(b)
	if err != nil {
		return false
	}
	return sameShape(ra, rb)
}
