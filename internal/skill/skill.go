// Package skill holds the guide an AI agent in a pane reads to use muxway.
package skill

import _ "embed"

//go:embed SKILL.md
var Text string
