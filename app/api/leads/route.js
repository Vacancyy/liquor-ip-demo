import { createLead, listLeads } from "../../../server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listLeads());
}

export async function POST(request) {
  const body = await request.json();
  return Response.json(await createLead(body), { status: 201 });
}
