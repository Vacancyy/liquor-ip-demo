import {
  addOfficialSource,
  addStructuredProductName,
  addUploadedSample,
  deleteOfficialSource,
  deleteStructuredProductName,
  getAdminKnowledge,
  updateOfficialSource,
  updateJudgementStrategy,
  updateStructuredProductName
} from "../../../../lib/admin-knowledge.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error, status = 400) {
  return Response.json({ error: error.message || "操作失败" }, { status });
}

export async function GET() {
  return Response.json(await getAdminKnowledge());
}

export async function POST(request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return Response.json(await addUploadedSample(await request.formData()), { status: 201 });
    }

    const body = await request.json();
    if (body.type === "officialSource") {
      return Response.json(await addOfficialSource(body.item || body), { status: 201 });
    }
    if (body.type === "productName") {
      return Response.json(await addStructuredProductName(body.name), { status: 201 });
    }
    return errorResponse(new Error("不支持的新增类型"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    if (body.type === "officialSource") {
      return Response.json(await updateOfficialSource(body.id, body.patch || {}));
    }
    if (body.type === "productName") {
      return Response.json(await updateStructuredProductName(body.oldName, body.newName));
    }
    if (body.type === "judgementStrategy") {
      return Response.json(await updateJudgementStrategy(body.strategy || {}));
    }
    return errorResponse(new Error("不支持的编辑类型"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const id = url.searchParams.get("id");
    const name = url.searchParams.get("name");

    if (type === "officialSource") return Response.json(await deleteOfficialSource(id));
    if (type === "productName") return Response.json(await deleteStructuredProductName(name));
    return errorResponse(new Error("不支持的删除类型"));
  } catch (error) {
    return errorResponse(error);
  }
}
