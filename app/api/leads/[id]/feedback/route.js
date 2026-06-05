import { addFeedback } from "../../../../../server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { id } = await params;
  const lead = await addFeedback(id, await request.json());
  if (!lead) return Response.json({ error: "lead_not_found" }, { status: 404 });
  return Response.json(lead);
}
