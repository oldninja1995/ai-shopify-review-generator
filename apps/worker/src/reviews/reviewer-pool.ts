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
/** Exactly one plain "First Last" attempt.
 *
 * This was 4, which was right while the namespace was empty and wrong the moment it filled. Plain
 * combinations are first-names x surnames — 17,250 per gender — and a store generating hundreds of
 * thousands of reviews exhausts that completely. Every plain attempt then became a guaranteed
 * failed INSERT, and since reviewers are minted sequentially, a 55-review product paid ~220 pointless
 * round-trips before doing any real work. One attempt keeps clean names while they last and costs
 * almost nothing once they don't. */
const PLAIN_NAME_ATTEMPTS = 1;
/** After this many failures, use two initials. One initial multiplies the space 21x (~362k per
 * gender); two makes it ~7.6M, which keeps insert retries rare no matter how large the store gets. */
const DOUBLE_INITIAL_AFTER = 6;

function randomName(gender: ReviewerGender, attempt: number): string {
  const first = pick(gender === "MALE" ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES);
  const last = pick(LAST_NAMES);
  if (attempt < PLAIN_NAME_ATTEMPTS) return `${first} ${last}`;
  if (attempt < DOUBLE_INITIAL_AFTER) return `${first} ${pick(NAME_INITIALS)} ${last}`;
  return `${first} ${pick(NAME_INITIALS)} ${pick(NAME_INITIALS)} ${last}`;
}

/** A reviewer identity that exists only in memory.
 *
 * Personas are built without touching the database, so a batch prompt can name its reviewers
 * without committing a row for each. Only slots that actually produce a review get persisted.
 * Previously a profile was inserted for every requested slot up front, so a product asking for 100
 * reviews and receiving none still created 100 rows — production reached 185,000 profiles against
 * 2,900 reviews, and those inserts became the bulk of the work the worker was doing. */
export type ReviewerPersona = {
  name: string;
  gender: ReviewerGender;
  country: string;
  ageGroup: string;
  occupation: string;
  isVerifiedPurchase: boolean;
};

export function buildReviewerPersona(gender: ReviewerGender, attempt = 0): ReviewerPersona {
  return {
    name: randomName(gender, attempt),
    gender,
    country: pick(COUNTRIES),
    ageGroup: pick(AGE_GROUPS),
    occupation: pick(OCCUPATIONS),
    isVerifiedPurchase: Math.random() < 0.7,
  };
}

/** Persists a persona, renaming on collision. Every other attribute is kept, so the identity the
 * review was actually written for survives even when the name has to change. */
export async function persistReviewerPersona(storeId: string, persona: ReviewerPersona) {
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
    // Attempt 0 uses the name the review was generated against; later ones re-roll only the name.
    const name = attempt === 0 ? persona.name : randomName(persona.gender, attempt);
    try {
      return await prisma.reviewerProfile.create({ data: { storeId, ...persona, name } });
    } catch (error) {
      if (attempt === MAX_NAME_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error(`Failed to persist a unique reviewer after ${MAX_NAME_ATTEMPTS} attempts`);
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
