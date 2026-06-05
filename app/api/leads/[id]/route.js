import { getLead } from "../../../../server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) return Response.json({ error: "lead_not_found" }, { status: 404 });
  return Response.json(lead);
}
