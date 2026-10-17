# Promo video toolkit

Rebuilds the 31-second 1080x1080 Instagram/LinkedIn ad for Wizard's Chess.

Final output of the last build: `~/Downloads/wizards_chess_ad_1080x1080.mp4` (not committed, 17 MB).

## How it was made
1. `ad.js` runs inside the game page (served from this repo with `python3 -m http.server 8765`).
   It scripts a Legal's-mate game in 2-player mode, composites motion graphics over the WebGL canvas
   at 1080x1080, records with MediaRecorder (H.264) and POSTs the result to `asset_server.py`.
2. `asset_server.py` (port 8766) serves `ad.js` and `avatar.jpg` with CORS headers and stores the upload.
   Put the creator photo next to it as `avatar.jpg` (the GitHub avatar was used).
3. Inject into the page: `const s = document.createElement('script'); s.src = 'http://127.0.0.1:8766/ad.js'; document.body.appendChild(s);`
   then read `window.__adLog` for the event times and save them as `events.json`.
4. Voice lines `vo1..vo5.mp3`: Microsoft neural voice via `edge-tts` (`en-US-AndrewNeural`); the outro card has no voice line.
5. Soundtrack (music bed, shatter/impact effects, UI dings, voice ducking): `VO_EXT=mp3 python3 make_audio.py events.json <duration> audio_mix.wav` (needs numpy, ffmpeg).
6. Mux: `ffmpeg -i upload_wizards_chess_ad_raw.mp4 -i audio_mix.wav -c:v libx264 -crf 17 -pix_fmt yuv420p -r 30 -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 192k -movflags +faststart out.mp4`
