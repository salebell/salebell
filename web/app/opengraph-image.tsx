import { ImageResponse } from "next/og";
import { BELL_PATHS } from "@/components/brand";

export const alt = "Salebell: a ping for every in-app purchase and subscription. No SDK.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#0e0e0c",
          color: "#ecebe6",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg viewBox="0 0 32 32" width="56" height="56">
            <rect width="32" height="32" rx="8" fill="#4fd18f" />
            {BELL_PATHS.map((d) => (

              <path key={d} d={d} fill="none" stroke="#04140b" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />

            ))}
          </svg>
          <span style={{ fontSize: 38, fontWeight: 600, letterSpacing: -1 }}>Salebell</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3, maxWidth: 980 }}>
            A ping for every in-app purchase, the second it happens.
          </div>
          <div style={{ fontSize: 32, color: "#a19e95" }}>In-app purchase and subscription alerts for iOS. No SDK.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              background: "#1d1d1a",
              border: "1px solid #3d3c37",
              borderRadius: 22,
              padding: "18px 26px",
              fontSize: 28,
            }}
          >
            <span>💰</span>
            <span style={{ fontWeight: 600 }}>Focus Timer · $14.99</span>
            <span style={{ color: "#a19e95" }}>Purchase · pro.lifetime · USA</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
