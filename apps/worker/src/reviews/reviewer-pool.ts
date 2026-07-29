import { prisma, type ReviewerGender } from "@ai-shopify/db";
import {
  AGE_GROUPS,
  COUNTRIES,
  FEMALE_FIRST_NAMES,
  LAST_NAMES,
  MALE_FIRST_NAMES,
  NAME_INITIALS,
  OCCUPATIONS,
} from "./content-bank.js";

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

const MAX_NAME_ATTEMPTS = 25;
/** Plain "First Last" is preferred while the namespace is uncrowded; only once collisions start
 * does an initial get added. That keeps most names in the cleanest form and reserves the 21x
 * widening for when it's actually needed. */
const PLAIN_NAME_ATTEMPTS = 4;

function randomName(gender: ReviewerGender, attempt: number): string {
  const first = pick(gender === "MALE" ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES);
  const last = pick(LAST_NAMES);
  if (attempt < PLAIN_NAME_ATTEMPTS) return `${first} ${last}`;
  return `${first} ${pick(NAME_INITIALS)} ${last}`;
}

/** Creates a reviewer nobody in this store has used before. The unique [storeId, name] constraint
 * is the authority — attempts simply retry against it, which is race-safe under concurrent workers
 * in a way that a pre-check "is this name taken" query would not be. */
async function createSyntheticReviewer(storeId: string, gender: ReviewerGender) {
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
    const name = randomName(gender, attempt);
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
      if (attempt === MAX_NAME_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error(`Failed to create a unique reviewer after ${MAX_NAME_ATTEMPTS} attempts`);
}

/**
 * Returns a brand-new reviewer profile for this store. Every review gets its own identity.
 *
 * This used to draw from existing profiles and only mint a new one when a single product's batch
 * exhausted a gender — which meant the pool stopped growing at roughly the largest per-product
 * demand (306 profiles) while the store accumulated hundreds of thousands of reviews, so each name
 * ended up credited with ~980 reviews. Repeated reviewer identity at that density is the most
 * visible fake-review signal there is, so reuse is now never acceptable: the caller's used-ids set
 * is unnecessary because nothing is ever reused in the first place.
 */
export async function getOrCreateReviewer(storeId: string, gender: ReviewerGender) {
  return createSyntheticReviewer(storeId, gender);
}
