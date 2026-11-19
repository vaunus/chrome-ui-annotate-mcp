// Pins the unpacked extension ID. Chrome derives the ID from this public key,
// so it is the same on every machine. The private key was thrown away: it is
// only needed to pack a .crx, which this project does not do.
// The extension manifest uses EXTENSION_PUBLIC_KEY as its "key".
// The server only accepts WebSocket connections from EXTENSION_ORIGIN.

export const EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsFygMBYqg46OprcA+JuoQfiP8pzaypokqt89uYIvta4DsuyYW4BoToV3F/ILB3nmoCq4QBl+qRwNtynAQgGrNvQzNftz8guvEtdrrlHdI+NDv7zka2HQ7BqVQWGcjj3wL4PlPfjfqSHGOgtz0focNQE05lpCfbN3yaGOJDyExLm5pY+ANhOr6AJ1M9p7TjQZD3A1WmR3x0N2a88I6CuPU0yz1fs6zFAcbHoyftp2DiFdWGu1aJjid0RfIUyL8oQA8H+TRasSoKehDuHGT03RF/RNV94R7IMBrX1Z12YDmuYRS+T/4CP1XtNtxItAFfhYtnbY8FXctSV+B5ilSVlhXwIDAQAB"

export const EXTENSION_ID = "nonnongclefdlijamdemalmombjidbhb"

export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`
