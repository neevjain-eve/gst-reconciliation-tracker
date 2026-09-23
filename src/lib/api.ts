import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { UploadError } from "./import/parse-file";
import { ApiError, apiCtx, type Ctx } from "./session";

type Handler<P> = (req: NextRequest, ctx: Ctx, params: P) => Promise<Response | object>;

/** Wraps a route handler: authenticates, resolves params and converts thrown errors into JSON responses. */
export function apiRoute<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const ctx = await apiCtx();
      const params = await context.params;
      const res = await handler(req, ctx, params);
      return res instanceof Response ? res : NextResponse.json(res);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  if (e instanceof UploadError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: e.issues[0]?.message ?? "Validation failed", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  console.error("[api] unhandled error", e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export async function parseJson<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams));
}
