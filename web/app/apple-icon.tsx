import { ImageResponse } from "next/og";
import { BELL_PATHS } from "@/components/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b7a4b" }}>
        <svg viewBox="0 0 32 32" width="132" height="132">
          {BELL_PATHS.map((d) => (

            <path key={d} d={d} fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />

          ))}
        </svg>
      </div>
    ),
    size,
  );
}
