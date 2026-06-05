import { analyzeLead } from "../../../../../server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(_request, { params }) {
  const { id } = await params;
  const lead = await analyzeLead(id);
  if (!lead) return Response.json({ error: "lead_not_found" }, { status: 404 });
  return Response.json(lead);
}
