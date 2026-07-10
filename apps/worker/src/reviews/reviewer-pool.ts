import { prisma, type ReviewerGender } from "@ai-shopify/db";
import {
  AGE_GROUPS,
  COUNTRIES,
  FEMALE_FIRST_NAMES,
  LAST_NAMES,
  MALE_FIRST_NAMES,
  OCCUPATIONS,
} from "./content-bank.js";

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function randomName(gender: ReviewerGender): string {
  const first = pick(gender === "MALE" ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES);
  const last = pick(LAST_NAMES);
  return `${first} ${last}`;
}

async function createSyntheticReviewer(storeId: string, gender: ReviewerGender) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const name = randomName(gender);
    try {
      return await prisma.reviewerProfile.create({
        data: {
          storeId,
          name,
          gender,
          country: pick(COUNTRIES),
          ageGroup: pick(AGE_GROUPS),
          occupation: pick(OCCUPATIONS),
          isVerifiedPurchase: Math.random() < 0.7,
        },
      });
    } catch (error) {
      // Unique [storeId, name] collision — retry with a different name.
      if (attempt === 9) throw error;
    }
  }
  throw new Error("Failed to create a synthetic reviewer after 10 attempts");
}

/**
 * Returns a reviewer profile of the given gender for this store, preferring one not already
 * used (id in `excludeIds`). Creates a new synthetic profile if the pool is exhausted.
 */
export async function getOrCreateReviewer(
  storeId: string,
  gender: ReviewerGender,
  excludeIds: Set<string>,
) {
  const existing = await prisma.reviewerProfile.findFirst({
    where: { storeId, gender, id: { notIn: Array.from(excludeIds) } },
  });
  if (existing) return existing;

  return createSyntheticReviewer(storeId, gender);
}
