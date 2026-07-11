import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess, updateReviewSchema } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { zodErrorToFieldErrors } from "@/lib/validation";

async function findOwnedReview(userId: string, reviewId: string) {
  return prisma.generatedReview.findFirst({
    where: { id: reviewId, product: { store: { userId } } },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const { id } = await params;
  const existing = await findOwnedReview(user.id, id);
  if (!existing) {
    return NextResponse.json(apiFailure("Review not found", { code: "NOT_FOUND" }), { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }

  const review = await prisma.generatedReview.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(apiSuccess({ review }));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const { id } = await params;
  const existing = await findOwnedReview(user.id, id);
  if (!existing) {
    return NextResponse.json(apiFailure("Review not found", { code: "NOT_FOUND" }), { status: 404 });
  }

  await prisma.generatedReview.delete({ where: { id } });

  return NextResponse.json(apiSuccess({ deleted: true }));
}
