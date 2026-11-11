// Whether a fit need not be sent: the pane is kept at a size the
// listing has, the one asked (zoomed, when the fit asks a zoom). A fit
// that takes a pane back from a zoom this page made is sent all the
// same: the listing is a poll, and one answered before the zoom was
// applied still has the pane at the size its tile asks for when the
// tiles come back, while the host has it zoomed; spared, the fit back
// would be lost and the pane left zoomed at a width nobody asked for.
export interface Known {
  cols: number;
  rows: number;
  zoomed?: boolean;
}

export function spared(
  have: Known | undefined,
  ask: { cols: number; rows: number },
  zoom: boolean,
  zoomedHere: boolean,
): boolean {
  if (!have) return false;
  if (!zoom && zoomedHere) return false;
  return have.cols === ask.cols && have.rows === ask.rows && (!zoom || !!have.zoomed);
}
