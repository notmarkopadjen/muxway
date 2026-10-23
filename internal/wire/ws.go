package wire

import (
	"context"
	"errors"

	"github.com/coder/websocket"
)

// WS adapts a WebSocket to the message interface the handshake uses.
type WS struct{ C *websocket.Conn }

func (w WS) Read(ctx context.Context) ([]byte, error) {
	t, msg, err := w.C.Read(ctx)
	if err != nil {
		return nil, err
	}
	if t != websocket.MessageBinary {
		return nil, errors.New("unexpected text message")
	}
	return msg, nil
}

func (w WS) Write(ctx context.Context, msg []byte) error {
	return w.C.Write(ctx, websocket.MessageBinary, msg)
}
