import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the brand mark — Hostinger
// violet rounded square + white chat-square glyph — matching the
// sidebar logo in `src/components/layout/sidebar.tsx`. Next.js renders
// this at build time and auto-injects <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
 return new ImageResponse(
 (
 <div
 style={{
 width: "100%",
 height: "100%",
 display: "flex",
 alignItems: "center",
 justifyContent: "center",
 background: "#ffffff", // white
 borderRadius: 6,
 }}
 >
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "#000000",
            fontFamily: "sans-serif",
          }}
        >
          B
        </div>
 </div>
 ),
 { ...size },
 );
}
