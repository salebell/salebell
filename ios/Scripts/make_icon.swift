// Draws the Salebell app icon (1024×1024 PNG): a white bell with a gold coin clapper, ringing.
// Usage: swift Scripts/make_icon.swift <output.png>
// The sign-in screen shows the same artwork: copy it to BrandMark.imageset at 512px (see ios/README.md).
import AppKit
import CoreGraphics

let size = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.png"
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                    space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
let s = CGFloat(size)

func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}
func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) } // y grows upwards

// Background: emerald to deep teal, with a soft light in the upper left.
let bg = CGGradient(colorsSpace: space, colors: [color(0x16C26A), color(0x0B6E63), color(0x07383F)] as CFArray,
                    locations: [0, 0.6, 1])!
ctx.drawLinearGradient(bg, start: p(0, 1), end: p(1, 0), options: [])
let glow = CGGradient(colorsSpace: space, colors: [color(0xFFFFFF, 0.22), color(0xFFFFFF, 0)] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(glow, startCenter: p(0.28, 0.8), startRadius: 0, endCenter: p(0.28, 0.8), endRadius: s * 0.7, options: [])

// Glyphs at 85% around the centre, so the outer sound arcs keep a margin from the edge.
ctx.saveGState()
ctx.translateBy(x: s * 0.5, y: s * 0.5)
ctx.scaleBy(x: 0.85, y: 0.85)
ctx.translateBy(x: -s * 0.5, y: -s * 0.5)

// Tilt the whole bell a little, as if it is ringing.
ctx.saveGState()
ctx.translateBy(x: s * 0.5, y: s * 0.72)
ctx.rotate(by: -0.12)
ctx.translateBy(x: -s * 0.5, y: -s * 0.72)

// Sound arcs on both sides.
ctx.setLineCap(.round)
ctx.setStrokeColor(color(0xFFFFFF, 0.75))
ctx.setLineWidth(s * 0.035)
for r in [0.34, 0.43] as [CGFloat] {
    ctx.addArc(center: p(0.5, 0.52), radius: s * r, startAngle: -0.45, endAngle: 0.45, clockwise: false)
    ctx.strokePath()
    ctx.addArc(center: p(0.5, 0.52), radius: s * r, startAngle: .pi - 0.45, endAngle: .pi + 0.45, clockwise: false)
    ctx.strokePath()
}

// Bell body.
let bell = CGMutablePath()
bell.move(to: p(0.25, 0.36))
bell.addCurve(to: p(0.33, 0.60), control1: p(0.30, 0.42), control2: p(0.325, 0.54))
bell.addCurve(to: p(0.67, 0.60), control1: p(0.34, 0.80), control2: p(0.66, 0.80))
bell.addCurve(to: p(0.75, 0.36), control1: p(0.675, 0.54), control2: p(0.70, 0.42))
bell.closeSubpath()
let rim = CGPath(roundedRect: CGRect(x: 0.20 * s, y: 0.31 * s, width: 0.60 * s, height: 0.07 * s),
                 cornerWidth: 0.035 * s, cornerHeight: 0.035 * s, transform: nil)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 40, color: color(0x000000, 0.35))
ctx.setFillColor(color(0xFFFFFF))
// Separate fills: body and rim run in opposite directions, so one fill would leave a hole.
ctx.beginTransparencyLayer(auxiliaryInfo: nil)
ctx.addPath(bell)
ctx.fillPath()
ctx.addPath(rim)
ctx.fillPath()
// Knob on top.
ctx.fillEllipse(in: CGRect(x: 0.46 * s, y: 0.735 * s, width: 0.08 * s, height: 0.08 * s))
ctx.endTransparencyLayer()
ctx.restoreGState()

// Gold coin clapper.
let r = s * 0.065
ctx.setFillColor(color(0xFFD34E))
ctx.fillEllipse(in: CGRect(x: 0.5 * s - r, y: 0.255 * s - r, width: r * 2, height: r * 2))
ctx.setStrokeColor(color(0xE0A800))
ctx.setLineWidth(s * 0.012)
ctx.strokeEllipse(in: CGRect(x: 0.5 * s - r * 0.62, y: 0.255 * s - r * 0.62, width: r * 1.24, height: r * 1.24))
ctx.restoreGState()
ctx.restoreGState()

let image = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: image)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
