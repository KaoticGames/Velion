/**
 * campaignCharacterAuth.ts
 *
 * Allows campaign DMs to read and mutate characters enrolled in their campaigns,
 * in addition to the character owner.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db }              from '../db';
import { characters, campaignCharacters, campaigns } from '../db/schema';

export type CharacterAccess = 'owner' | 'campaign_dm' | 'none';

export async function getCharacterAccess(
  characterId: string,
  userId: string,
): Promise<{ access: CharacterAccess; character: typeof characters.$inferSelect | null }> {
  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);

  if (!character) return { access: 'none', character: null };
  if (character.user_id === userId) return { access: 'owner', character };

  const dmRows = await db
    .select({ id: campaigns.id })
    .from(campaignCharacters)
    .innerJoin(campaigns, eq(campaigns.id, campaignCharacters.campaign_id))
    .where(and(
      eq(campaignCharacters.character_id, characterId),
      isNull(campaignCharacters.removed_at),
      isNull(campaigns.deleted_at),
      eq(campaigns.dm_user_id, userId),
    ))
    .limit(1);

  if (dmRows.length > 0) return { access: 'campaign_dm', character };
  return { access: 'none', character };
}

export function canManageCharacter(access: CharacterAccess): boolean {
  return access === 'owner' || access === 'campaign_dm';
}
