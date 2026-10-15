#!/usr/bin/env bash
# Regenerates public/sample.mp4: a 6 s spinning card with a frame counter and progress bar.
# Keyframes are deliberately sparse (every 3 s) so the "Before" preview visibly stutters.
# Font paths are for Windows; point FONT_BOLD and FONT_MONO elsewhere on other systems.
set -euo pipefail
FONT_BOLD="${FONT_BOLD:-C\\:/Windows/Fonts/segoeuib.ttf}"
FONT_MONO="${FONT_MONO:-C\\:/Windows/Fonts/consola.ttf}"
cd "$(dirname "$0")/.."
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "gradients=s=960x540:r=30:d=6:n=3:c0=0x140c2e:c1=0x2a1a6e:c2=0x0b4f63:speed=0.015" \
  -f lavfi -i "color=c=0x7c5cff:s=240x240:r=30:d=6,format=rgba" \
  -f lavfi -i "color=c=black@0.0:s=360x360:r=30:d=6,format=rgba" \
  -f lavfi -i "color=c=0x22d3ee:s=960x8:r=30:d=6" \
  -filter_complex "[1]drawbox=x=0:y=0:w=iw:h=ih:color=0xc4b5fd:t=10,drawtext=fontfile='${FONT_BOLD}':text='PREP':fontcolor=white:fontsize=64:x=(w-tw)/2:y=(h-th)/2[sq];[2][sq]overlay=60:60:format=auto,rotate=a=t*PI/3:c=black@0.0[card];[0][card]overlay=x=(W-w)/2:y=(H-h)/2-10:format=auto[a];[a][3]overlay=x=-W+W*t/6:y=H-8[b];[b]drawtext=fontfile='${FONT_MONO}':text='frame %{eif\:n\:d\:3}':fontcolor=white:fontsize=30:x=28:y=H-60,format=yuv420p" \
  -t 6 -c:v libx264 -preset slow -crf 23 -g 90 -sc_threshold 0 -movflags +faststart public/sample.mp4
echo "wrote public/sample.mp4"
