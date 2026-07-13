import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess, bulkApproveReviewsSchema } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { zodErrorToFieldErrors } from "@/lib/validation";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const body = await request.json().catch(() => null);
  const parsed = bulkApproveReviewsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }

  const result = await prisma.generatedReview.updateMany({
    where: { id: { in: parsed.data.ids }, status: "DRAFT", product: { store: { userId: user.id } } },
    data: { status: "APPROVED" },
  });

  return NextResponse.json(apiSuccess({ approvedCount: result.count }));
}
