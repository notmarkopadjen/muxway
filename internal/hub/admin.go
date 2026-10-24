package hub

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/notmarkopadjen/muxway/internal/secure"
)

// The owner manages a running hub through a Unix socket in its state
// directory. Only the directory's owner can reach it.

// AdminRequest is one command on the admin socket.
type AdminRequest struct {
	Cmd   string        `json:"cmd"`
	Host  string        `json:"host,omitempty"`
	Name  string        `json:"name,omitempty"`
	Read  []string      `json:"read,omitempty"`
	Write []string      `json:"write,omitempty"`
	TTL   time.Duration `json:"ttl,omitempty"`
	ID    string        `json:"id,omitempty"`
	Email string        `json:"email,omitempty"`
	Admin bool          `json:"admin,omitempty"`
	List  string        `json:"list,omitempty"` // "allow" or "deny"
	Addrs []string      `json:"addrs,omitempty"`
}

// AdminResponse answers it.
type AdminResponse struct {
	Error  string        `json:"error,omitempty"`
	Code   string        `json:"code,omitempty"`
	Secret string        `json:"secret,omitempty"`
	Token  *Token        `json:"token,omitempty"`
	Tokens []Token       `json:"tokens,omitempty"`
	Agents []AgentStatus `json:"agents,omitempty"`
	User   *User         `json:"user,omitempty"`
	Users  []User        `json:"users,omitempty"`
	Access *Access       `json:"access,omitempty"`
}

// AgentStatus is a paired agent and whether it is connected.
type AgentStatus struct {
	Host   string `json:"host"`
	Online bool   `json:"online"`
}

func adminPath(dir string) string { return filepath.Join(dir, "admin.sock") }

func (h *Hub) listenAdmin() (net.Listener, error) {
	path := adminPath(h.cfg.Dir)
	os.Remove(path)
	ln, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	return ln, os.Chmod(path, 0o600)
}

func (h *Hub) serveAdmin(ctx context.Context, ln net.Listener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		go func() {
			defer c.Close()
			c.SetDeadline(time.Now().Add(10 * time.Second))
			var req AdminRequest
			if err := json.NewDecoder(bufio.NewReader(c)).Decode(&req); err != nil {
				return
			}
			json.NewEncoder(c).Encode(h.admin(req))
		}()
	}
}

func (h *Hub) admin(req AdminRequest) AdminResponse {
	switch req.Cmd {
	case "pair-code":
		if !hostName.MatchString(req.Host) {
			return AdminResponse{Error: "host aliases are 1 to 32 of a-z, 0-9 and -"}
		}
		if h.cfg.PublicURL == "" {
			return AdminResponse{Error: "the hub has no --public-url to put in the code"}
		}
		ttl := req.TTL
		if ttl <= 0 || ttl > time.Hour {
			ttl = 10 * time.Minute
		}
		id, secret := secure.Random(9), secure.Random(16)
		h.mu.Lock()
		h.codes[id] = &pairCode{host: req.Host, secret: secret, expires: time.Now().Add(ttl)}
		h.mu.Unlock()
		code := secure.PairCode{URL: h.cfg.PublicURL, HubKey: secure.EncodePublic(h.PublicKey()),
			Host: req.Host, ID: id, Secret: secret}
		h.log.Info("pairing code issued", "host", req.Host, "valid", ttl)
		return AdminResponse{Code: code.String()}
	case "token-create":
		secret, t, err := h.newToken(req.Name, req.Read, req.Write, req.Admin, req.TTL, "socket")
		if err != nil {
			return AdminResponse{Error: err.Error()}
		}
		return AdminResponse{Secret: secret, Token: &t}
	case "token-list":
		tokens := h.store.tokens()
		for i := range tokens {
			tokens[i].Hash = ""
		}
		return AdminResponse{Tokens: tokens}
	case "token-revoke":
		if err := h.dropToken(req.ID, "socket"); errors.Is(err, errNotFound) {
			return AdminResponse{Error: "no such token"}
		} else if err != nil {
			return AdminResponse{Error: err.Error()}
		}
		return AdminResponse{}
	case "user-create":
		u, err := h.newUser(req.Email, req.Name, req.Read, req.Write, req.Admin, req.TTL, "socket")
		if err != nil {
			return AdminResponse{Error: err.Error()}
		}
		return AdminResponse{User: &u}
	case "user-list":
		return AdminResponse{Users: h.store.users()}
	case "user-remove":
		if err := h.dropUser(req.ID, "socket"); errors.Is(err, errNotFound) {
			return AdminResponse{Error: "no such user"}
		} else if err != nil {
			return AdminResponse{Error: err.Error()}
		}
		return AdminResponse{}
	case "access-list":
		a := h.store.access()
		return AdminResponse{Access: &a}
	case "access-add", "access-clear":
		a := h.store.access()
		var list *[]string
		switch req.List {
		case "allow":
			list = &a.Allow
		case "deny":
			list = &a.Deny
		case "":
			if req.Cmd == "access-clear" {
				a = Access{}
				break
			}
			fallthrough
		default:
			return AdminResponse{Error: "which list? allow or deny"}
		}
		if list != nil {
			if req.Cmd == "access-clear" {
				*list = nil
			} else {
				*list = append(*list, req.Addrs...)
			}
		}
		a, err := h.putAccess(a, "socket")
		if err != nil {
			return AdminResponse{Error: err.Error()}
		}
		return AdminResponse{Access: &a}
	case "agent-list":
		var out []AgentStatus
		for _, host := range h.store.agents() {
			out = append(out, AgentStatus{host, h.agent(host) != nil})
		}
		return AdminResponse{Agents: out}
	case "agent-remove":
		ok, err := h.store.removeAgent(req.Host)
		if err != nil {
			return AdminResponse{Error: err.Error()}
		}
		if !ok {
			return AdminResponse{Error: "no such agent"}
		}
		if a := h.agent(req.Host); a != nil {
			a.cancel()
		}
		h.log.Info("agent removed", "host", req.Host)
		return AdminResponse{}
	}
	return AdminResponse{Error: "unknown command"}
}

// Admin sends one command to the hub running in dir.
func Admin(dir string, req AdminRequest) (AdminResponse, error) {
	var resp AdminResponse
	c, err := net.DialTimeout("unix", adminPath(dir), 5*time.Second)
	if err != nil {
		return resp, errors.New("no hub running in " + dir)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(10 * time.Second))
	if err := json.NewEncoder(c).Encode(req); err != nil {
		return resp, err
	}
	if err := json.NewDecoder(c).Decode(&resp); err != nil {
		return resp, err
	}
	if resp.Error != "" {
		return resp, errors.New(resp.Error)
	}
	return resp, nil
}
