import release from "@/installer/release.json";
export function GET() {
  return Response.json({ release: release.id }, { headers: { "cache-control": "no-store" } });
}
