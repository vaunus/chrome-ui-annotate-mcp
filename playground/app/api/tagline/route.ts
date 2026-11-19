// Test case: text that comes from an API, not from source. Claude must fail cleanly.
export function GET() {
  return Response.json({ tagline: "Trusted by 4,000 teams worldwide" });
}
