/**
 * seed_general_items.ts
 * Run with: npx tsx src/db/seed_general_items.ts
 * Safe to re-run — skips items that already exist by name.
 */

import path from 'path';
import { config } from 'dotenv';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
config({ path: path.resolve(process.cwd(), envFile) });
config({ path: path.resolve(process.cwd(), '.env') });

import { drizzle }    from 'drizzle-orm/node-postgres';
import { Pool }       from 'pg';
import { eq }         from 'drizzle-orm';
import { generalItems } from './schema/inventory';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const db   = drizzle(pool);

const ITEMS: Omit<typeof generalItems.$inferInsert, 'id'>[] = [
  // ── Healing & Consumables ──────────────────────────────────────────────
  {
    name: 'Minor Healing Potion',   category: 'consumable', weight: '0.5',
    value_gold: 25,  stackable: true,
    description: 'A small vial of cherry-red restorative liquid.',
    effect: 'Restores 500 HP when consumed.',
  },
  {
    name: 'Healing Potion',         category: 'consumable', weight: '0.5',
    value_gold: 75,  stackable: true,
    description: 'A standard healing potion carried by adventurers across Velion.',
    effect: 'Restores 2,000 HP when consumed.',
  },
  {
    name: 'Greater Healing Potion', category: 'consumable', weight: '0.5',
    value_gold: 200, stackable: true,
    description: 'A thick, luminescent potion sealed with wax.',
    effect: 'Restores 6,000 HP when consumed.',
  },
  {
    name: 'Superior Healing Potion',category: 'consumable', weight: '0.5',
    value_gold: 500, stackable: true,
    description: 'Rumoured to contain a drop of divine ichor.',
    effect: 'Restores 15,000 HP when consumed.',
  },
  {
    name: 'Antidote',               category: 'consumable', weight: '0.25',
    value_gold: 50,  stackable: true,
    description: 'A bitter tincture that neutralises most natural poisons.',
    effect: 'Removes the Poisoned state.',
  },
  {
    name: 'Smelling Salts',         category: 'consumable', weight: '0.1',
    value_gold: 15,  stackable: true,
    description: 'Sharp-smelling salts in a cloth wrap.',
    effect: 'Can revive a Downed character to 1 HP (outside combat only).',
  },
  {
    name: 'Ration (1 day)',         category: 'consumable', weight: '1.0',
    value_gold: 2,   stackable: true,
    description: 'Dried meat, hard biscuit, and a small wedge of cheese.',
    effect: 'Sustains one character for one day of travel.',
  },
  {
    name: 'Waterskin',              category: 'consumable', weight: '1.5',
    value_gold: 2,   stackable: false,
    description: 'A sealed leather pouch holding roughly a litre of water.',
    effect: 'Holds enough water for one character for one day.',
  },

  // ── Light Sources ──────────────────────────────────────────────────────
  {
    name: 'Torch',                  category: 'light', weight: '0.5',
    value_gold: 1,   stackable: true,
    description: 'A pitch-wrapped wooden torch.',
    effect: 'Sheds bright light in a 20ft radius for 1 hour.',
  },
  {
    name: 'Lantern (Hooded)',       category: 'light', weight: '1.0',
    value_gold: 10,  stackable: false,
    description: 'A shuttered lantern that can focus or dim its beam.',
    effect: 'Sheds bright light in a 30ft cone for 6 hours per flask of oil.',
  },
  {
    name: 'Oil Flask',              category: 'consumable', weight: '0.5',
    value_gold: 2,   stackable: true,
    description: 'A clay flask of rendered lamp oil.',
    effect: 'Fuels a hooded lantern for 6 hours, or can be thrown as a fire hazard.',
  },
  {
    name: 'Candle',                 category: 'light', weight: '0.1',
    value_gold: 1,   stackable: true,
    description: 'A thin tallow candle.',
    effect: 'Sheds dim light in a 5ft radius for 1 hour.',
  },
  {
    name: 'Tinderbox',              category: 'tool', weight: '0.25',
    value_gold: 5,   stackable: false,
    description: 'Flint, steel, and a small wad of tinder in a tin case.',
    effect: 'Used to light fires. Starting a fire takes 1 minute; lighting a candle or torch is immediate.',
  },

  // ── Rope & Climbing ────────────────────────────────────────────────────
  {
    name: 'Hempen Rope (50ft)',     category: 'tool', weight: '5.0',
    value_gold: 5,   stackable: false,
    description: 'Fifty feet of coiled hemp rope.',
    effect: 'Can hold up to 1,000 lbs. Agility check (DC 12) to climb without aid.',
  },
  {
    name: 'Silk Rope (50ft)',       category: 'tool', weight: '2.5',
    value_gold: 25,  stackable: false,
    description: 'Fine woven silk rope, far lighter and stronger than hemp.',
    effect: 'Can hold up to 1,500 lbs. Advantage on Agility checks to climb.',
  },
  {
    name: 'Grappling Hook',        category: 'tool', weight: '2.0',
    value_gold: 10,  stackable: false,
    description: 'A four-pronged iron hook for attaching rope to ledges.',
    effect: 'Thrown to anchor rope to a surface up to 40ft away (Power check DC 10).',
  },

  // ── Tools & Utility ────────────────────────────────────────────────────
  {
    name: 'Crowbar',               category: 'tool', weight: '2.5',
    value_gold: 5,   stackable: false,
    description: 'A heavy iron pry bar.',
    effect: '+2 to Power checks involving forcing open doors, chests, or gates.',
  },
  {
    name: 'Lockpicks',             category: 'tool', weight: '0.25',
    value_gold: 20,  stackable: false,
    description: 'A set of slender iron picks in a leather roll.',
    effect: 'Required for picking locks. +2 to Agility checks for lockpicking.',
  },
  {
    name: 'Hunting Trap',          category: 'tool', weight: '5.0',
    value_gold: 8,   stackable: false,
    description: 'A spring-loaded iron jaw trap.',
    effect: 'Can be set in 1 minute. A creature that steps on it must pass a Power check (DC 13) or be Restrained.',
  },
  {
    name: 'Shovel',                category: 'tool', weight: '3.0',
    value_gold: 4,   stackable: false,
    description: 'A sturdy iron-headed digging shovel.',
    effect: 'Used for digging, excavation, and burying.',
  },
  {
    name: 'Healer\'s Kit',         category: 'tool', weight: '1.5',
    value_gold: 30,  stackable: false,
    description: 'Bandages, splints, antiseptic salve, and needle and thread. 10 uses.',
    effect: 'Spend one use to stabilise a Downed character outside combat (Focus check DC 10).',
  },
  {
    name: 'Spyglass',              category: 'tool', weight: '0.5',
    value_gold: 100, stackable: false,
    description: 'A collapsible brass spyglass.',
    effect: '+4 to Focus checks for spotting distant objects or creatures.',
  },
  {
    name: 'Writing Kit',           category: 'tool', weight: '0.5',
    value_gold: 8,   stackable: false,
    description: 'Quill, inkwell, and a small sheaf of parchment.',
    effect: 'Required for copying spells, mapping, or writing messages.',
  },
  {
    name: 'Compass',               category: 'tool', weight: '0.1',
    value_gold: 20,  stackable: false,
    description: 'A brass compass on a chain.',
    effect: 'Prevents getting lost via natural navigation in non-magical terrain.',
  },

  // ── Containers ─────────────────────────────────────────────────────────
  {
    name: 'Backpack',              category: 'container', weight: '1.0',
    value_gold: 5,   stackable: false,
    description: 'A sturdy leather backpack with multiple compartments.',
    effect: 'Standard pack for carrying adventuring gear.',
  },
  {
    name: 'Sack',                  category: 'container', weight: '0.25',
    value_gold: 1,   stackable: true,
    description: 'A rough cloth sack.',
    effect: 'Can hold up to 30 lbs.',
  },
  {
    name: 'Chest (Small)',         category: 'container', weight: '10.0',
    value_gold: 15,  stackable: false,
    description: 'An iron-banded wooden chest with a hasp for a padlock.',
    effect: 'Securely holds up to 50 lbs of items. Can be locked.',
  },
  {
    name: 'Pouch',                 category: 'container', weight: '0.1',
    value_gold: 1,   stackable: true,
    description: 'A small drawstring leather pouch.',
    effect: 'Holds up to 6 lbs or 200 coins.',
  },

  // ── Misc ───────────────────────────────────────────────────────────────
  {
    name: 'Bedroll',               category: 'misc', weight: '3.0',
    value_gold: 3,   stackable: false,
    description: 'A rolled blanket and thin pad for sleeping outdoors.',
    effect: 'Required for a comfortable Long Rest in the wilderness.',
  },
  {
    name: 'Tent (2-person)',       category: 'misc', weight: '10.0',
    value_gold: 15,  stackable: false,
    description: 'A canvas lean-to tent with stakes and rope.',
    effect: 'Provides shelter for two characters during a Long Rest.',
  },
  {
    name: 'Mirror (Steel)',        category: 'misc', weight: '0.25',
    value_gold: 10,  stackable: false,
    description: 'A small polished steel hand mirror.',
    effect: 'Useful for looking around corners, signalling, or checking for breath.',
  },
  {
    name: 'Manacles',              category: 'misc', weight: '2.0',
    value_gold: 10,  stackable: false,
    description: 'Heavy iron restraints with a keyhole.',
    effect: 'Can bind a humanoid. Breaking free requires a Power check DC 18.',
  },
  {
    name: 'Dice Set',              category: 'misc', weight: '0.1',
    value_gold: 1,   stackable: false,
    description: 'A small leather cup with six ivory dice.',
    effect: 'Used for gambling and games of chance.',
  },
];

async function seed() {
  console.log('[seed_general_items] Starting…');
  let inserted = 0;
  let skipped  = 0;

  for (const item of ITEMS) {
    const existing = await db
      .select({ id: generalItems.id })
      .from(generalItems)
      .where(eq(generalItems.name, item.name))
      .limit(1);

    if (existing.length) {
      skipped++;
      continue;
    }

    await db.insert(generalItems).values(item);
    inserted++;
    console.log(`  + ${item.name}`);
  }

  console.log(`[seed_general_items] Done — ${inserted} inserted, ${skipped} skipped.`);
  await pool.end();
}

seed().catch((err) => {
  console.error('[seed_general_items] Failed:', err);
  process.exit(1);
});