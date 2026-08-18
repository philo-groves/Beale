# Beale Capture Companion

The iOS 27 companion captures user-selected iPhone screen content with ScreenCaptureKit and sends transient JPEG frames to Beale through a USB tunnel.

- The system picker provides capture consent on the iPhone.
- Beale launches the companion with an ephemeral token for each session.
- The companion accepts an authenticated stream client on TCP port `59727`.
- `iproxy` exposes that device port only on Mac loopback.
- The `screen-capture` background mode keeps an approved full-display stream active while the user navigates to other apps.
- Neither side persists captured frames.

Build and deployment require Xcode 27 and a connected iOS 27 device.
