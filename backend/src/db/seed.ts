/**
 * Velion Mythera — Library Seed Data
 * Dev:  npm run db:seed
 * Prod: npm run build && npm run db:seed:prod  (uses compiled JS; no tsx required)
 *
 * Populates the library with official (is_homebrew: false) content.
 * All values sourced from the Velion Mythera Player's Guide and SRD.
 *
 * Weapon die types by category (base_die_type = number of sides):
 *   Dagger d4 | Short Sword / Rapier / Bow / Staff d6 | Long Sword / Axe / Mace / Warhammer d8
 *
 * Rarity dice budget: Common=1, Uncommon=2, Rare=3, Epic=4, Legendary=5, Mythic=6
 * Gem slots by weapon rarity: Common=0, Uncommon=1, Rare=2, Epic=3, Legendary=4, Mythic=5
 *
 * Armor mitigation is additive across all 7 slots.
 * Soft cap recommendation: ~60% total physical mitigation.
 */

import path from 'path';
import { config } from 'dotenv';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
config({ path: path.resolve(process.cwd(), envFile) });
config({ path: path.resolve(process.cwd(), '.env') });

import { db } from './index';
import {
  weapons, weaponChannels,
  armorPieces,
  spellGems,
  focusBracers,
  enemies, enemyAttackTiers,
} from './schema';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const official = { is_homebrew: false as const, is_public: true as const, created_by: null };

// Insert a weapon + its channels atomically, return the weapon id
async function seedWeapon(
  w: {
    name: string;
    category: string;
    rarity: string;
    base_die_type: number;
    total_dice_budget: number;
    req_power?: number;
    req_agility?: number;
    req_focus?: number;
    gem_slots?: number;
    description: string;
  },
  channels: Array<{ damage_type: string; num_dice: number }>
): Promise<string> {
  const [weapon] = await db.insert(weapons).values({
    ...w,
    req_power:  w.req_power  ?? 0,
    req_agility: w.req_agility ?? 0,
    req_focus:  w.req_focus  ?? 0,
    gem_slots:  w.gem_slots  ?? 0,
    ...official,
    version: 1,
  }).returning();

  if (channels.length) {
    await db.insert(weaponChannels).values(
      channels.map((c) => ({ weapon_id: weapon.id, ...c }))
    );
  }
  return weapon.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEAPONS
// ─────────────────────────────────────────────────────────────────────────────
//
// Single-channel weapons use the full dice budget on one damage type.
// Multi-channel weapons split the budget — total of channel num_dice must equal total_dice_budget.
// Gem slots: Common=0, Uncommon=1, Rare=2, Epic=3, Legendary=4, Mythic=5

async function seedWeapons() {
  console.log('  Seeding weapons...');

  // ── DAGGERS (d4, piercing) ────────────────────────────────────────────────
  await seedWeapon({
    name: 'Common Dagger', category: 'dagger', rarity: 'common',
    base_die_type: 4, total_dice_budget: 1, gem_slots: 0,
    description: 'A simple iron dagger. Reliable and easy to conceal.',
  }, [{ damage_type: 'piercing', num_dice: 1 }]);

  await seedWeapon({
    name: 'Uncommon Dagger', category: 'dagger', rarity: 'uncommon',
    base_die_type: 4, total_dice_budget: 2, gem_slots: 1,
    description: 'A well-balanced blade with a finely honed edge. Holds a single gem slot.',
  }, [{ damage_type: 'piercing', num_dice: 2 }]);

  await seedWeapon({
    name: 'Rare Dagger', category: 'dagger', rarity: 'rare',
    base_die_type: 4, total_dice_budget: 3, req_agility: 12, gem_slots: 2,
    description: 'A masterwork dagger favoured by specialists. Requires Agility 12.',
  }, [{ damage_type: 'piercing', num_dice: 3 }]);

  await seedWeapon({
    name: 'Shadowfang Dagger', category: 'dagger', rarity: 'rare',
    base_die_type: 4, total_dice_budget: 3, req_agility: 12, gem_slots: 2,
    description: 'A dark steel blade that whispers as it cuts. Deals piercing and shadow damage.',
  }, [
    { damage_type: 'piercing', num_dice: 2 },
    { damage_type: 'shadow',   num_dice: 1 },
  ]);

  // ── SHORT SWORDS (d6, slashing) ───────────────────────────────────────────
  await seedWeapon({
    name: 'Common Short Sword', category: 'short_sword', rarity: 'common',
    base_die_type: 6, total_dice_budget: 1, gem_slots: 0,
    description: 'A standard single-edged blade. The weapon of choice for new adventurers.',
  }, [{ damage_type: 'slashing', num_dice: 1 }]);

  await seedWeapon({
    name: 'Uncommon Short Sword', category: 'short_sword', rarity: 'uncommon',
    base_die_type: 6, total_dice_budget: 2, gem_slots: 1,
    description: 'A tempered blade with improved balance. Accepts one gem.',
  }, [{ damage_type: 'slashing', num_dice: 2 }]);

  await seedWeapon({
    name: 'Rare Short Sword', category: 'short_sword', rarity: 'rare',
    base_die_type: 6, total_dice_budget: 3, req_agility: 11, gem_slots: 2,
    description: 'A precision-forged blade. Requires Agility 11.',
  }, [{ damage_type: 'slashing', num_dice: 3 }]);

  await seedWeapon({
    name: 'Flame Short Sword', category: 'short_sword', rarity: 'rare',
    base_die_type: 6, total_dice_budget: 3, req_agility: 11, gem_slots: 2,
    description: 'A blade whose edge burns with elemental fire. Deals slashing and fire damage.',
  }, [
    { damage_type: 'slashing', num_dice: 2 },
    { damage_type: 'fire',     num_dice: 1 },
  ]);

  await seedWeapon({
    name: 'Epic Short Sword', category: 'short_sword', rarity: 'epic',
    base_die_type: 6, total_dice_budget: 4, req_agility: 14, gem_slots: 3,
    description: 'A blade of exceptional craft and power. Requires Agility 14.',
  }, [{ damage_type: 'slashing', num_dice: 4 }]);

  await seedWeapon({
    name: 'Frostbite Blade', category: 'short_sword', rarity: 'epic',
    base_die_type: 6, total_dice_budget: 4, req_agility: 14, gem_slots: 3,
    description: 'A cold-forged blade that freezes at the point of contact. Slashing and ice damage.',
  }, [
    { damage_type: 'slashing', num_dice: 3 },
    { damage_type: 'ice',      num_dice: 1 },
  ]);

  // ── LONG SWORDS / BROADSWORDS (d8, slashing) ─────────────────────────────
  await seedWeapon({
    name: 'Common Long Sword', category: 'long_sword', rarity: 'common',
    base_die_type: 8, total_dice_budget: 1, gem_slots: 0,
    description: 'A standard two-edged blade suited to versatile fighters.',
  }, [{ damage_type: 'slashing', num_dice: 1 }]);

  await seedWeapon({
    name: 'Uncommon Long Sword', category: 'long_sword', rarity: 'uncommon',
    base_die_type: 8, total_dice_budget: 2, gem_slots: 1,
    description: 'A well-crafted broadsword with a reinforced crossguard.',
  }, [{ damage_type: 'slashing', num_dice: 2 }]);

  await seedWeapon({
    name: 'Rare Broadsword', category: 'long_sword', rarity: 'rare',
    base_die_type: 8, total_dice_budget: 3, req_power: 11, gem_slots: 2,
    description: 'A broad, heavy blade that hits with considerable force. Requires Power 11.',
  }, [{ damage_type: 'slashing', num_dice: 3 }]);

  await seedWeapon({
    name: 'Thunderstrike Broadsword', category: 'long_sword', rarity: 'rare',
    base_die_type: 8, total_dice_budget: 3, req_power: 11, gem_slots: 2,
    description: 'A crackling blade that channels lightning with every swing. Slashing and lightning damage.',
  }, [
    { damage_type: 'slashing',   num_dice: 2 },
    { damage_type: 'lightning',  num_dice: 1 },
  ]);

  await seedWeapon({
    name: 'Epic Broadsword', category: 'long_sword', rarity: 'epic',
    base_die_type: 8, total_dice_budget: 4, req_power: 14, gem_slots: 3,
    description: 'A weapon of exceptional quality. Requires Power 14.',
  }, [{ damage_type: 'slashing', num_dice: 4 }]);

  // ── RAPIERS (d6, piercing) ────────────────────────────────────────────────
  await seedWeapon({
    name: 'Common Rapier', category: 'rapier', rarity: 'common',
    base_die_type: 6, total_dice_budget: 1, gem_slots: 0,
    description: 'A slender thrusting blade favored by duelists.',
  }, [{ damage_type: 'piercing', num_dice: 1 }]);

  await seedWeapon({
    name: 'Uncommon Rapier', category: 'rapier', rarity: 'uncommon',
    base_die_type: 6, total_dice_budget: 2, req_agility: 10, gem_slots: 1,
    description: 'A keen dueling blade. Agility 10 recommended.',
  }, [{ damage_type: 'piercing', num_dice: 2 }]);

  await seedWeapon({
    name: 'Rare Rapier', category: 'rapier', rarity: 'rare',
    base_die_type: 6, total_dice_budget: 3, req_agility: 13, gem_slots: 2,
    description: 'A master duelist\'s weapon. Requires Agility 13.',
  }, [{ damage_type: 'piercing', num_dice: 3 }]);

  // ── GREAT AXES (d8, slashing, two-handed) ─────────────────────────────────
  await seedWeapon({
    name: 'Common Great Axe', category: 'great_axe', rarity: 'common',
    base_die_type: 8, total_dice_budget: 1, req_power: 13, gem_slots: 0,
    description: 'A heavy two-handed axe. Requires Power 13.',
  }, [{ damage_type: 'slashing', num_dice: 1 }]);

  await seedWeapon({
    name: 'Uncommon Great Axe', category: 'great_axe', rarity: 'uncommon',
    base_die_type: 8, total_dice_budget: 2, req_power: 14, gem_slots: 1,
    description: 'A powerful axe with a reinforced haft. Requires Power 14.',
  }, [{ damage_type: 'slashing', num_dice: 2 }]);

  await seedWeapon({
    name: 'Rare Great Axe', category: 'great_axe', rarity: 'rare',
    base_die_type: 8, total_dice_budget: 3, req_power: 16, gem_slots: 2,
    description: 'A fearsome weapon of war. Requires Power 16.',
  }, [{ damage_type: 'slashing', num_dice: 3 }]);

  await seedWeapon({
    name: 'Epic Great Axe', category: 'great_axe', rarity: 'epic',
    base_die_type: 8, total_dice_budget: 4, req_power: 18, gem_slots: 3,
    description: 'A weapon that reshapes the battlefield with every blow. Requires Power 18.',
  }, [{ damage_type: 'slashing', num_dice: 4 }]);

  // ── WARHAMMERS (d8, bludgeoning, two-handed) ──────────────────────────────
  await seedWeapon({
    name: 'Common Warhammer', category: 'warhammer', rarity: 'common',
    base_die_type: 8, total_dice_budget: 1, req_power: 13, gem_slots: 0,
    description: 'A heavy maul designed for armour-breaking impact. Requires Power 13.',
  }, [{ damage_type: 'bludgeoning', num_dice: 1 }]);

  await seedWeapon({
    name: 'Uncommon Warhammer', category: 'warhammer', rarity: 'uncommon',
    base_die_type: 8, total_dice_budget: 2, req_power: 14, gem_slots: 1,
    description: 'A well-balanced war maul. Requires Power 14.',
  }, [{ damage_type: 'bludgeoning', num_dice: 2 }]);

  await seedWeapon({
    name: 'Rare Warhammer', category: 'warhammer', rarity: 'rare',
    base_die_type: 8, total_dice_budget: 3, req_power: 16, gem_slots: 2,
    description: 'A hammer that shatters armour and bones alike. Requires Power 16.',
  }, [{ damage_type: 'bludgeoning', num_dice: 3 }]);

  // ── MACES (d6, bludgeoning, one-handed) ──────────────────────────────────
  await seedWeapon({
    name: 'Common Mace', category: 'mace', rarity: 'common',
    base_die_type: 6, total_dice_budget: 1, gem_slots: 0,
    description: 'A flanged iron mace. Effective and straightforward.',
  }, [{ damage_type: 'bludgeoning', num_dice: 1 }]);

  await seedWeapon({
    name: 'Uncommon Mace', category: 'mace', rarity: 'uncommon',
    base_die_type: 6, total_dice_budget: 2, gem_slots: 1,
    description: 'A reinforced mace with heavier flanges.',
  }, [{ damage_type: 'bludgeoning', num_dice: 2 }]);

  await seedWeapon({
    name: 'Rare Mace', category: 'mace', rarity: 'rare',
    base_die_type: 6, total_dice_budget: 3, req_power: 11, gem_slots: 2,
    description: 'A weapon of significant impact potential. Requires Power 11.',
  }, [{ damage_type: 'bludgeoning', num_dice: 3 }]);

  // ── STAVES (d6, bludgeoning / arcane, Focus builds) ──────────────────────
  await seedWeapon({
    name: 'Common Staff', category: 'staff', rarity: 'common',
    base_die_type: 6, total_dice_budget: 1, gem_slots: 0,
    description: 'A carved wooden staff. Simple and versatile.',
  }, [{ damage_type: 'bludgeoning', num_dice: 1 }]);

  await seedWeapon({
    name: 'Uncommon Arcane Staff', category: 'staff', rarity: 'uncommon',
    base_die_type: 6, total_dice_budget: 2, req_focus: 11, gem_slots: 1,
    description: 'A staff etched with focus-amplifying runes. Requires Focus 11.',
  }, [{ damage_type: 'arcane', num_dice: 2 }]);

  await seedWeapon({
    name: 'Rare Arcane Staff', category: 'staff', rarity: 'rare',
    base_die_type: 6, total_dice_budget: 3, req_focus: 13, gem_slots: 2,
    description: 'A conduit for significant arcane power. Requires Focus 13.',
  }, [{ damage_type: 'arcane', num_dice: 3 }]);

  await seedWeapon({
    name: 'Ember Staff', category: 'staff', rarity: 'rare',
    base_die_type: 6, total_dice_budget: 3, req_focus: 13, gem_slots: 2,
    description: 'A staff wreathed in flame. Deals arcane and fire damage. Requires Focus 13.',
  }, [
    { damage_type: 'arcane', num_dice: 2 },
    { damage_type: 'fire',   num_dice: 1 },
  ]);

  await seedWeapon({
    name: 'Epic Arcane Staff', category: 'staff', rarity: 'epic',
    base_die_type: 6, total_dice_budget: 4, req_focus: 16, gem_slots: 3,
    description: 'A staff of formidable magical output. Requires Focus 16.',
  }, [{ damage_type: 'arcane', num_dice: 4 }]);

  // ── BOWS (d6, piercing, Agility builds) ───────────────────────────────────
  await seedWeapon({
    name: 'Common Shortbow', category: 'bow', rarity: 'common',
    base_die_type: 6, total_dice_budget: 1, req_agility: 10, gem_slots: 0,
    description: 'A simple shortbow. Reliable at range.',
  }, [{ damage_type: 'piercing', num_dice: 1 }]);

  await seedWeapon({
    name: 'Common Longbow', category: 'bow', rarity: 'common',
    base_die_type: 6, total_dice_budget: 1, req_agility: 12, gem_slots: 0,
    description: 'A tall bow with greater range and pull. Requires Agility 12.',
  }, [{ damage_type: 'piercing', num_dice: 1 }]);

  await seedWeapon({
    name: 'Uncommon Bow', category: 'bow', rarity: 'uncommon',
    base_die_type: 6, total_dice_budget: 2, req_agility: 12, gem_slots: 1,
    description: 'A composite bow with improved draw. Requires Agility 12.',
  }, [{ damage_type: 'piercing', num_dice: 2 }]);

  await seedWeapon({
    name: 'Rare Bow', category: 'bow', rarity: 'rare',
    base_die_type: 6, total_dice_budget: 3, req_agility: 14, gem_slots: 2,
    description: 'A precision-crafted bow for skilled archers. Requires Agility 14.',
  }, [{ damage_type: 'piercing', num_dice: 3 }]);

  await seedWeapon({
    name: 'Stormshot Bow', category: 'bow', rarity: 'rare',
    base_die_type: 6, total_dice_budget: 3, req_agility: 14, gem_slots: 2,
    description: 'Arrows crackle with electricity upon release. Piercing and lightning damage. Requires Agility 14.',
  }, [
    { damage_type: 'piercing',  num_dice: 2 },
    { damage_type: 'lightning', num_dice: 1 },
  ]);

  console.log('  ✓ Weapons seeded');
}

// ─────────────────────────────────────────────────────────────────────────────
// ARMOR
// ─────────────────────────────────────────────────────────────────────────────
//
// Mitigation is per piece (percentage). Total additive soft cap: ~60%.
// Rough per-slot targets at Common/Uncommon/Rare:
//   Chestplate: 4% / 7% / 11% (light) | 6% / 9% / 13% (medium) | 8% / 12% / 16% (heavy)
//   Helmet:     2% / 4% / 6%          | 3% / 5% / 8%           | 4% / 6% / 9%
//   Leggings:   3% / 5% / 7%          | 4% / 7% / 10%          | 5% / 8% / 11%
//   Gauntlets:  1% / 2% / 3%          | 2% / 3% / 5%           | 3% / 5% / 7%
//   Boots:      1% / 2% / 3%          | 2% / 3% / 5%           | 3% / 5% / 7%
//   Shirt:      1% / 2% / 3%          | 1% / 2% / 3%           | 2% / 3% / 4%
//   Pants:      1% / 2% / 3%          | 1% / 2% / 3%           | 2% / 3% / 4%
// Power requirements: Light=0, Medium=Common(0)/Uncommon(8)/Rare(11), Heavy=Common(12)/Uncommon(14)/Rare(16)

async function seedArmor() {
  console.log('  Seeding armor...');

  const armorData: Array<{
    name: string; category: string; slot: string; rarity: string;
    mitigation_percent: string; req_power: number; gem_slots: number; description: string;
  }> = [
    // ── LIGHT ARMOR (leather, fur, treated cloth) ─────────────────────────
    // Helmet
    { name: 'Common Leather Helm',     category: 'light', slot: 'helmet',     rarity: 'common',   mitigation_percent: '2.00',  req_power: 0,  gem_slots: 0, description: 'A basic leather cap offering minimal head protection.' },
    { name: 'Uncommon Leather Helm',   category: 'light', slot: 'helmet',     rarity: 'uncommon', mitigation_percent: '4.00',  req_power: 0,  gem_slots: 1, description: 'A padded leather helm with a reinforced brow.' },
    { name: 'Rare Leather Helm',       category: 'light', slot: 'helmet',     rarity: 'rare',     mitigation_percent: '6.00',  req_power: 0,  gem_slots: 2, description: 'A masterworked light helm of treated leather.' },
    // Chestplate
    { name: 'Common Leather Vest',     category: 'light', slot: 'chestplate', rarity: 'common',   mitigation_percent: '4.00',  req_power: 0,  gem_slots: 0, description: 'A simple leather vest. The standard starting point for light-armored builds.' },
    { name: 'Uncommon Leather Vest',   category: 'light', slot: 'chestplate', rarity: 'uncommon', mitigation_percent: '7.00',  req_power: 0,  gem_slots: 1, description: 'A reinforced leather vest with layered panels.' },
    { name: 'Rare Leather Cuirass',    category: 'light', slot: 'chestplate', rarity: 'rare',     mitigation_percent: '11.00', req_power: 0,  gem_slots: 2, description: 'A masterworked leather cuirass, hardened and supple.' },
    // Leggings
    { name: 'Common Leather Leggings', category: 'light', slot: 'leggings',   rarity: 'common',   mitigation_percent: '3.00',  req_power: 0,  gem_slots: 0, description: 'Lightweight leather leg protection.' },
    { name: 'Uncommon Leather Leggings',category: 'light',slot: 'leggings',   rarity: 'uncommon', mitigation_percent: '5.00',  req_power: 0,  gem_slots: 1, description: 'Reinforced leather leggings with articulated knees.' },
    { name: 'Rare Leather Leggings',   category: 'light', slot: 'leggings',   rarity: 'rare',     mitigation_percent: '7.00',  req_power: 0,  gem_slots: 2, description: 'Master-crafted leather leggings with layered guards.' },
    // Gauntlets
    { name: 'Common Leather Gloves',   category: 'light', slot: 'gauntlets',  rarity: 'common',   mitigation_percent: '1.00',  req_power: 0,  gem_slots: 0, description: 'Simple padded leather gloves.' },
    { name: 'Uncommon Leather Gloves', category: 'light', slot: 'gauntlets',  rarity: 'uncommon', mitigation_percent: '2.00',  req_power: 0,  gem_slots: 1, description: 'Reinforced leather gloves with knuckle guards.' },
    { name: 'Rare Leather Gauntlets',  category: 'light', slot: 'gauntlets',  rarity: 'rare',     mitigation_percent: '3.00',  req_power: 0,  gem_slots: 1, description: 'Supple gauntlets of hardened leather.' },
    // Boots
    { name: 'Common Leather Boots',    category: 'light', slot: 'boots',      rarity: 'common',   mitigation_percent: '1.00',  req_power: 0,  gem_slots: 0, description: 'Comfortable leather boots with soft soles.' },
    { name: 'Uncommon Leather Boots',  category: 'light', slot: 'boots',      rarity: 'uncommon', mitigation_percent: '2.00',  req_power: 0,  gem_slots: 1, description: 'Reinforced leather boots with ankle support.' },
    { name: 'Rare Leather Boots',      category: 'light', slot: 'boots',      rarity: 'rare',     mitigation_percent: '3.00',  req_power: 0,  gem_slots: 1, description: 'Hardened leather boots crafted for swift movement.' },
    // Shirt
    { name: 'Common Padded Shirt',     category: 'light', slot: 'shirt',      rarity: 'common',   mitigation_percent: '1.00',  req_power: 0,  gem_slots: 0, description: 'A quilted padded undergarment. Minimal but better than nothing.' },
    { name: 'Uncommon Padded Shirt',   category: 'light', slot: 'shirt',      rarity: 'uncommon', mitigation_percent: '2.00',  req_power: 0,  gem_slots: 0, description: 'A thicker padded shirt with multiple quilted layers.' },
    // Pants
    { name: 'Common Padded Pants',     category: 'light', slot: 'pants',      rarity: 'common',   mitigation_percent: '1.00',  req_power: 0,  gem_slots: 0, description: 'Basic padded trousers worn beneath other armour.' },
    { name: 'Uncommon Padded Pants',   category: 'light', slot: 'pants',      rarity: 'uncommon', mitigation_percent: '2.00',  req_power: 0,  gem_slots: 0, description: 'Reinforced padded trousers providing modest additional protection.' },

    // ── MEDIUM ARMOR (hide, scale mail, reinforced leather) ───────────────
    // Helmet
    { name: 'Common Hide Helm',        category: 'medium', slot: 'helmet',     rarity: 'common',   mitigation_percent: '3.00',  req_power: 0,  gem_slots: 0, description: 'A sturdy hide helm with a rigid crown.' },
    { name: 'Uncommon Scale Helm',     category: 'medium', slot: 'helmet',     rarity: 'uncommon', mitigation_percent: '5.00',  req_power: 8,  gem_slots: 1, description: 'A helm of overlapping scale plates. Requires Power 8.' },
    { name: 'Rare Scale Helm',         category: 'medium', slot: 'helmet',     rarity: 'rare',     mitigation_percent: '8.00',  req_power: 11, gem_slots: 2, description: 'A finely crafted scale helm with a reinforced visor. Requires Power 11.' },
    // Chestplate
    { name: 'Common Hide Vest',        category: 'medium', slot: 'chestplate', rarity: 'common',   mitigation_percent: '6.00',  req_power: 0,  gem_slots: 0, description: 'A layered hide chest piece. Good middle-ground protection.' },
    { name: 'Uncommon Scale Vest',     category: 'medium', slot: 'chestplate', rarity: 'uncommon', mitigation_percent: '9.00',  req_power: 8,  gem_slots: 1, description: 'A scale mail vest offering solid torso protection. Requires Power 8.' },
    { name: 'Rare Scale Cuirass',      category: 'medium', slot: 'chestplate', rarity: 'rare',     mitigation_percent: '13.00', req_power: 11, gem_slots: 2, description: 'A masterworked scale cuirass. Requires Power 11.' },
    // Leggings
    { name: 'Common Hide Leggings',    category: 'medium', slot: 'leggings',   rarity: 'common',   mitigation_percent: '4.00',  req_power: 0,  gem_slots: 0, description: 'Thick hide leggings with reinforced joints.' },
    { name: 'Uncommon Scale Leggings', category: 'medium', slot: 'leggings',   rarity: 'uncommon', mitigation_percent: '7.00',  req_power: 8,  gem_slots: 1, description: 'Scale mail leggings with articulated knee guards. Requires Power 8.' },
    { name: 'Rare Scale Leggings',     category: 'medium', slot: 'leggings',   rarity: 'rare',     mitigation_percent: '10.00', req_power: 11, gem_slots: 2, description: 'Masterworked scale leggings. Requires Power 11.' },
    // Gauntlets
    { name: 'Common Hide Gloves',      category: 'medium', slot: 'gauntlets',  rarity: 'common',   mitigation_percent: '2.00',  req_power: 0,  gem_slots: 0, description: 'Reinforced hide gloves with knuckle protection.' },
    { name: 'Uncommon Scale Gauntlets',category: 'medium', slot: 'gauntlets',  rarity: 'uncommon', mitigation_percent: '3.00',  req_power: 8,  gem_slots: 1, description: 'Scale-backed gauntlets. Requires Power 8.' },
    { name: 'Rare Scale Gauntlets',    category: 'medium', slot: 'gauntlets',  rarity: 'rare',     mitigation_percent: '5.00',  req_power: 11, gem_slots: 1, description: 'Finely articulated scale gauntlets. Requires Power 11.' },
    // Boots
    { name: 'Common Hide Boots',       category: 'medium', slot: 'boots',      rarity: 'common',   mitigation_percent: '2.00',  req_power: 0,  gem_slots: 0, description: 'Thick hide boots with rigid ankle support.' },
    { name: 'Uncommon Scale Boots',    category: 'medium', slot: 'boots',      rarity: 'uncommon', mitigation_percent: '3.00',  req_power: 8,  gem_slots: 1, description: 'Scale-plated boots. Requires Power 8.' },
    { name: 'Rare Scale Boots',        category: 'medium', slot: 'boots',      rarity: 'rare',     mitigation_percent: '5.00',  req_power: 11, gem_slots: 1, description: 'Reinforced scale boots with plated toes. Requires Power 11.' },
    // Shirt
    { name: 'Common Ringweave Shirt',  category: 'medium', slot: 'shirt',      rarity: 'common',   mitigation_percent: '1.00',  req_power: 0,  gem_slots: 0, description: 'A shirt of tightly woven rings providing modest underarmour coverage.' },
    { name: 'Uncommon Ringweave Shirt',category: 'medium', slot: 'shirt',      rarity: 'uncommon', mitigation_percent: '2.00',  req_power: 8,  gem_slots: 0, description: 'A finer ringweave shirt with denser coverage.' },
    // Pants
    { name: 'Common Ringweave Pants',  category: 'medium', slot: 'pants',      rarity: 'common',   mitigation_percent: '1.00',  req_power: 0,  gem_slots: 0, description: 'Ringweave trousers providing underarmour leg coverage.' },
    { name: 'Uncommon Ringweave Pants',category: 'medium', slot: 'pants',      rarity: 'uncommon', mitigation_percent: '2.00',  req_power: 8,  gem_slots: 0, description: 'Denser ringweave trousers for medium-armour builds.' },

    // ── HEAVY ARMOR (chain, plate, full steel) ────────────────────────────
    // Helmet
    { name: 'Common Chainmail Helm',   category: 'heavy', slot: 'helmet',     rarity: 'common',   mitigation_percent: '4.00',  req_power: 12, gem_slots: 0, description: 'A chainmail coif and skullcap. Requires Power 12.' },
    { name: 'Uncommon Plate Helm',     category: 'heavy', slot: 'helmet',     rarity: 'uncommon', mitigation_percent: '6.00',  req_power: 14, gem_slots: 1, description: 'A solid plate helm with a raised visor. Requires Power 14.' },
    { name: 'Rare Plate Helm',         category: 'heavy', slot: 'helmet',     rarity: 'rare',     mitigation_percent: '9.00',  req_power: 16, gem_slots: 2, description: 'A masterforged plate helm with a reinforced brow guard. Requires Power 16.' },
    // Chestplate
    { name: 'Common Chainmail Hauberk',category: 'heavy', slot: 'chestplate', rarity: 'common',   mitigation_percent: '8.00',  req_power: 12, gem_slots: 0, description: 'A full chainmail hauberk. The core of any heavy armour build. Requires Power 12.' },
    { name: 'Uncommon Plate Chestplate',category:'heavy', slot: 'chestplate', rarity: 'uncommon', mitigation_percent: '12.00', req_power: 14, gem_slots: 1, description: 'A solid plate chestplate — the heaviest piece in most loadouts. Requires Power 14.' },
    { name: 'Rare Plate Chestplate',   category: 'heavy', slot: 'chestplate', rarity: 'rare',     mitigation_percent: '16.00', req_power: 16, gem_slots: 2, description: 'A masterforged plate chestplate of exceptional quality. Requires Power 16.' },
    // Leggings
    { name: 'Common Chainmail Leggings',category:'heavy', slot: 'leggings',   rarity: 'common',   mitigation_percent: '5.00',  req_power: 12, gem_slots: 0, description: 'Chainmail leg protection. Requires Power 12.' },
    { name: 'Uncommon Plate Leggings', category: 'heavy', slot: 'leggings',   rarity: 'uncommon', mitigation_percent: '8.00',  req_power: 14, gem_slots: 1, description: 'Full plate leggings with articulated knees. Requires Power 14.' },
    { name: 'Rare Plate Leggings',     category: 'heavy', slot: 'leggings',   rarity: 'rare',     mitigation_percent: '11.00', req_power: 16, gem_slots: 2, description: 'Masterforged plate leggings with a close-fitted silhouette. Requires Power 16.' },
    // Gauntlets
    { name: 'Common Chain Gauntlets',  category: 'heavy', slot: 'gauntlets',  rarity: 'common',   mitigation_percent: '3.00',  req_power: 12, gem_slots: 0, description: 'Chainmail gauntlets with riveted palm guards.' },
    { name: 'Uncommon Plate Gauntlets',category: 'heavy', slot: 'gauntlets',  rarity: 'uncommon', mitigation_percent: '5.00',  req_power: 14, gem_slots: 1, description: 'Full plate gauntlets. Requires Power 14.' },
    { name: 'Rare Plate Gauntlets',    category: 'heavy', slot: 'gauntlets',  rarity: 'rare',     mitigation_percent: '7.00',  req_power: 16, gem_slots: 1, description: 'Masterforged plate gauntlets. Requires Power 16.' },
    // Boots
    { name: 'Common Plate Boots',      category: 'heavy', slot: 'boots',      rarity: 'common',   mitigation_percent: '3.00',  req_power: 12, gem_slots: 0, description: 'Heavy plate sabatons. Noisy but protective. Requires Power 12.' },
    { name: 'Uncommon Plate Boots',    category: 'heavy', slot: 'boots',      rarity: 'uncommon', mitigation_percent: '5.00',  req_power: 14, gem_slots: 1, description: 'Reinforced plate boots with layered toe caps. Requires Power 14.' },
    { name: 'Rare Plate Boots',        category: 'heavy', slot: 'boots',      rarity: 'rare',     mitigation_percent: '7.00',  req_power: 16, gem_slots: 1, description: 'Masterforged plate sabatons. Requires Power 16.' },
    // Shirt
    { name: 'Common Chainmail Shirt',  category: 'heavy', slot: 'shirt',      rarity: 'common',   mitigation_percent: '2.00',  req_power: 12, gem_slots: 0, description: 'A short chainmail undercoat worn beneath a hauberk.' },
    { name: 'Uncommon Chainmail Shirt',category: 'heavy', slot: 'shirt',      rarity: 'uncommon', mitigation_percent: '3.00',  req_power: 14, gem_slots: 0, description: 'A reinforced chainmail shirt of tighter weave.' },
    { name: 'Rare Chainmail Shirt',    category: 'heavy', slot: 'shirt',      rarity: 'rare',     mitigation_percent: '4.00',  req_power: 16, gem_slots: 1, description: 'A masterworked chainmail shirt with riveted butted rings.' },
    // Pants
    { name: 'Common Chainmail Pants',  category: 'heavy', slot: 'pants',      rarity: 'common',   mitigation_percent: '2.00',  req_power: 12, gem_slots: 0, description: 'Chainmail trousers worn as under-layer to plate leggings.' },
    { name: 'Uncommon Chainmail Pants',category: 'heavy', slot: 'pants',      rarity: 'uncommon', mitigation_percent: '3.00',  req_power: 14, gem_slots: 0, description: 'Reinforced chainmail trousers.' },
    { name: 'Rare Chainmail Pants',    category: 'heavy', slot: 'pants',      rarity: 'rare',     mitigation_percent: '4.00',  req_power: 16, gem_slots: 1, description: 'Masterworked chainmail trousers, dense and close-fitting.' },
  ];

  await db.insert(armorPieces).values(
    armorData.map((a) => ({ ...a, ...official, version: 1 }))
  );

  console.log('  ✓ Armor seeded');
}

// ─────────────────────────────────────────────────────────────────────────────
// SPELL GEMS
// ─────────────────────────────────────────────────────────────────────────────
//
// Rarity → dice: Common=1d6, Uncommon=1d6 (+minor effect), Rare=2d6, Epic=3d6
// Element types: fire, ice, lightning, earth, wind, light, shadow, arcane, nature, poison

async function seedSpellGems() {
  console.log('  Seeding spell gems...');

  type GemRow = {
    name: string; element_type: string; rarity: string;
    num_dice: number; die_type: number;
    armor_resistance_percent: string;
    secondary_effect: string | null;
    description: string;
  };

  const gemData: GemRow[] = [
    // ── FIRE ─────────────────────────────────────────────────────────────
    { name: 'Common Fire Gem',      element_type: 'fire',      rarity: 'common',   num_dice: 1, die_type: 6, armor_resistance_percent: '2.00',  secondary_effect: null,             description: 'A gem containing compressed flame energy.' },
    { name: 'Uncommon Fire Gem',    element_type: 'fire',      rarity: 'uncommon', num_dice: 1, die_type: 6, armor_resistance_percent: '4.00',  secondary_effect: 'May apply Burned', description: 'A fire gem with sufficient heat to ignite targets.' },
    { name: 'Rare Fire Gem',        element_type: 'fire',      rarity: 'rare',     num_dice: 2, die_type: 6, armor_resistance_percent: '7.00',  secondary_effect: 'Applies Burned',   description: 'A dense fire gem capable of sustained burning.' },
    { name: 'Epic Fire Gem',        element_type: 'fire',      rarity: 'epic',     num_dice: 3, die_type: 6, armor_resistance_percent: '12.00', secondary_effect: 'Applies Burned; may Stun', description: 'A gem of intense volcanic power.' },

    // ── ICE ───────────────────────────────────────────────────────────────
    { name: 'Common Ice Gem',       element_type: 'ice',       rarity: 'common',   num_dice: 1, die_type: 6, armor_resistance_percent: '2.00',  secondary_effect: null,               description: 'A gem of crystallised cold energy.' },
    { name: 'Uncommon Ice Gem',     element_type: 'ice',       rarity: 'uncommon', num_dice: 1, die_type: 6, armor_resistance_percent: '4.00',  secondary_effect: 'May slow movement', description: 'Cold enough to chill the blood of its target.' },
    { name: 'Rare Ice Gem',         element_type: 'ice',       rarity: 'rare',     num_dice: 2, die_type: 6, armor_resistance_percent: '7.00',  secondary_effect: 'Applies Restrained', description: 'Ice deep enough to lock limbs in place.' },
    { name: 'Epic Ice Gem',         element_type: 'ice',       rarity: 'epic',     num_dice: 3, die_type: 6, armor_resistance_percent: '12.00', secondary_effect: 'Applies Restrained; Steps −1', description: 'A gem that can freeze a target solid momentarily.' },

    // ── LIGHTNING ─────────────────────────────────────────────────────────
    { name: 'Common Lightning Gem', element_type: 'lightning', rarity: 'common',   num_dice: 1, die_type: 6, armor_resistance_percent: '2.00',  secondary_effect: null,                description: 'A gem crackling with electrical charge.' },
    { name: 'Uncommon Lightning Gem',element_type:'lightning', rarity: 'uncommon', num_dice: 1, die_type: 6, armor_resistance_percent: '4.00',  secondary_effect: 'May Stun briefly',  description: 'A strong discharge capable of disrupting focus.' },
    { name: 'Rare Lightning Gem',   element_type: 'lightning', rarity: 'rare',     num_dice: 2, die_type: 6, armor_resistance_percent: '7.00',  secondary_effect: 'Applies Stunned',   description: 'A gem delivering a powerful nervous-system shock.' },
    { name: 'Epic Lightning Gem',   element_type: 'lightning', rarity: 'epic',     num_dice: 3, die_type: 6, armor_resistance_percent: '12.00', secondary_effect: 'Applies Stunned; chains to nearest enemy', description: 'A gem of overwhelming electrical force.' },

    // ── SHADOW ────────────────────────────────────────────────────────────
    { name: 'Common Shadow Gem',    element_type: 'shadow',    rarity: 'common',   num_dice: 1, die_type: 6, armor_resistance_percent: '2.00',  secondary_effect: null,                description: 'A gem of condensed void energy.' },
    { name: 'Uncommon Shadow Gem',  element_type: 'shadow',    rarity: 'uncommon', num_dice: 1, die_type: 6, armor_resistance_percent: '4.00',  secondary_effect: 'May apply Frightened', description: 'Shadow energy that unnerves targets.' },
    { name: 'Rare Shadow Gem',      element_type: 'shadow',    rarity: 'rare',     num_dice: 2, die_type: 6, armor_resistance_percent: '7.00',  secondary_effect: 'Applies Frightened', description: 'Deep shadow that invades the mind as well as the body.' },

    // ── ARCANE ────────────────────────────────────────────────────────────
    { name: 'Common Arcane Gem',    element_type: 'arcane',    rarity: 'common',   num_dice: 1, die_type: 6, armor_resistance_percent: '2.00',  secondary_effect: null,                description: 'Pure magical energy, unaligned to any element.' },
    { name: 'Uncommon Arcane Gem',  element_type: 'arcane',    rarity: 'uncommon', num_dice: 1, die_type: 6, armor_resistance_percent: '4.00',  secondary_effect: 'May Silence',       description: 'Arcane interference capable of disrupting spellwork.' },
    { name: 'Rare Arcane Gem',      element_type: 'arcane',    rarity: 'rare',     num_dice: 2, die_type: 6, armor_resistance_percent: '7.00',  secondary_effect: 'Applies Silenced',  description: 'Dense arcane force that disrupts magical channels.' },

    // ── POISON ────────────────────────────────────────────────────────────
    { name: 'Common Poison Gem',    element_type: 'poison',    rarity: 'common',   num_dice: 1, die_type: 6, armor_resistance_percent: '2.00',  secondary_effect: null,                description: 'A gem of crystallised toxin.' },
    { name: 'Uncommon Poison Gem',  element_type: 'poison',    rarity: 'uncommon', num_dice: 1, die_type: 6, armor_resistance_percent: '4.00',  secondary_effect: 'May apply Poisoned', description: 'A concentrated toxin gem.' },
    { name: 'Rare Poison Gem',      element_type: 'poison',    rarity: 'rare',     num_dice: 2, die_type: 6, armor_resistance_percent: '7.00',  secondary_effect: 'Applies Poisoned',  description: 'A potent venom capable of persistent debilitation.' },

    // ── EARTH ─────────────────────────────────────────────────────────────
    { name: 'Common Earth Gem',     element_type: 'earth',     rarity: 'common',   num_dice: 1, die_type: 6, armor_resistance_percent: '2.00',  secondary_effect: null,                description: 'A gem of compressed stone and soil energy.' },
    { name: 'Uncommon Earth Gem',   element_type: 'earth',     rarity: 'uncommon', num_dice: 1, die_type: 6, armor_resistance_percent: '4.00',  secondary_effect: 'May apply Grappled', description: 'Earth energy capable of encasing limbs briefly.' },
    { name: 'Rare Earth Gem',       element_type: 'earth',     rarity: 'rare',     num_dice: 2, die_type: 6, armor_resistance_percent: '7.00',  secondary_effect: 'Applies Grappled',  description: 'Dense earthen force that can pin targets in place.' },

    // ── WIND ──────────────────────────────────────────────────────────────
    { name: 'Common Wind Gem',      element_type: 'wind',      rarity: 'common',   num_dice: 1, die_type: 6, armor_resistance_percent: '2.00',  secondary_effect: null,                description: 'A gem of compressed air and kinetic force.' },
    { name: 'Uncommon Wind Gem',    element_type: 'wind',      rarity: 'uncommon', num_dice: 1, die_type: 6, armor_resistance_percent: '4.00',  secondary_effect: 'May knock back target', description: 'Wind force capable of displacing a target.' },
    { name: 'Rare Wind Gem',        element_type: 'wind',      rarity: 'rare',     num_dice: 2, die_type: 6, armor_resistance_percent: '7.00',  secondary_effect: 'Knocks back; may Restrain', description: 'A gale-force gem of significant displacement potential.' },

    // ── LIGHT ─────────────────────────────────────────────────────────────
    { name: 'Common Light Gem',     element_type: 'light',     rarity: 'common',   num_dice: 1, die_type: 6, armor_resistance_percent: '2.00',  secondary_effect: null,                description: 'A gem of radiant energy. Highly effective against shadow-type enemies.' },
    { name: 'Uncommon Light Gem',   element_type: 'light',     rarity: 'uncommon', num_dice: 1, die_type: 6, armor_resistance_percent: '4.00',  secondary_effect: 'May Blind target',  description: 'Brilliant light capable of temporarily impairing vision.' },
    { name: 'Rare Light Gem',       element_type: 'light',     rarity: 'rare',     num_dice: 2, die_type: 6, armor_resistance_percent: '7.00',  secondary_effect: 'Applies Suppressed to undead/shadow', description: 'Concentrated radiance with targeted suppressive effect.' },

    // ── NATURE ────────────────────────────────────────────────────────────
    { name: 'Common Nature Gem',    element_type: 'nature',    rarity: 'common',   num_dice: 1, die_type: 6, armor_resistance_percent: '2.00',  secondary_effect: null,                description: 'A gem infused with organic energy.' },
    { name: 'Uncommon Nature Gem',  element_type: 'nature',    rarity: 'uncommon', num_dice: 1, die_type: 6, armor_resistance_percent: '4.00',  secondary_effect: 'Minor healing on hit', description: 'Nature energy that restores the caster on contact.' },
    { name: 'Rare Nature Gem',      element_type: 'nature',    rarity: 'rare',     num_dice: 2, die_type: 6, armor_resistance_percent: '7.00',  secondary_effect: 'Heals caster; may apply Bleeding to target', description: 'A gem of balanced growth and decay forces.' },
  ];

  await db.insert(spellGems).values(
    gemData.map((g) => ({ ...g, ...official, version: 1 }))
  );

  console.log('  ✓ Spell gems seeded');
}

// ─────────────────────────────────────────────────────────────────────────────
// FOCUS BRACERS
// ─────────────────────────────────────────────────────────────────────────────
//
// Grades: Initiate=2 slots, Adept=4 slots, Exemplar=6 slots, Ascendant=8 slots
// Focus requirements based on Players Guide: Low/Moderate/High/Exceptional

async function seedFocusBracers() {
  console.log('  Seeding focus bracers...');

  await db.insert(focusBracers).values([
    {
      name: 'Initiate Focus Bracer', grade: 'initiate', gem_slots: 2, req_focus: 10,
      description: 'The entry-level bracer for aspiring spellcasters. Channels two Spell Gems simultaneously. Requires Focus 10.',
      ...official, version: 1,
    },
    {
      name: 'Adept Focus Bracer', grade: 'adept', gem_slots: 4, req_focus: 13,
      description: 'A bracer of moderate power allowing four active gems. Requires Focus 13.',
      ...official, version: 1,
    },
    {
      name: 'Exemplar Focus Bracer', grade: 'exemplar', gem_slots: 6, req_focus: 16,
      description: 'A high-tier bracer for committed spellcasters. Channels six gems simultaneously. Requires Focus 16.',
      ...official, version: 1,
    },
    {
      name: 'Ascendant Focus Bracer', grade: 'ascendant', gem_slots: 8, req_focus: 20,
      description: 'The pinnacle of bracer craftsmanship. Channels eight gems at once. Requires Focus 20.',
      ...official, version: 1,
    },
  ]);

  console.log('  ✓ Focus bracers seeded');
}

// ─────────────────────────────────────────────────────────────────────────────
// ENEMIES
// ─────────────────────────────────────────────────────────────────────────────
//
// Classifications: minion | standard | elite | boss
// Attack tiers: Partial (2 steps) | Standard (3 steps) | Full (4–5 steps)
// damage_multiplier = the fixed RP equivalent used for damage calculation
// HP values scaled to be meaningful at level 1–5 (100–5000) up to boss tier (20000+)
// enemy_weight: minion=0.5, standard=1.0, elite=2.0, boss=4.0+

async function seedEnemies() {
  console.log('  Seeding enemies...');

  type EnemyDef = {
    name: string; classification: string; hp: number;
    resistance_modifier: number; enemy_weight: string;
    traits: Array<{ name: string; description: string }>;
    description: string;
    tiers: Array<{ tier_name: string; pressure_steps: number; damage_multiplier: number; max_pool_contribution: number }>;
  };

  const enemyDefs: EnemyDef[] = [
    // ── MINIONS ───────────────────────────────────────────────────────────
    {
      name: 'Goblin Scrapper', classification: 'minion', hp: 400,
      resistance_modifier: 0, enemy_weight: '0.50',
      traits: [],
      description: 'A small, scrappy goblin that attacks in packs. Individually weak but dangerous in numbers.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 1, damage_multiplier: 3,  max_pool_contribution: 5  },
        { tier_name: 'Standard', pressure_steps: 2, damage_multiplier: 6,  max_pool_contribution: 10 },
      ],
    },
    {
      name: 'Skeleton Archer', classification: 'minion', hp: 350,
      resistance_modifier: 0, enemy_weight: '0.50',
      traits: [{ name: 'Undead', description: 'Immune to Poisoned and Bleeding states. Vulnerable to Light damage.' }],
      description: 'A reanimated skeleton wielding a shortbow. Prefers to attack from range.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 1, damage_multiplier: 3,  max_pool_contribution: 5  },
        { tier_name: 'Standard', pressure_steps: 2, damage_multiplier: 5,  max_pool_contribution: 8  },
      ],
    },
    {
      name: 'Dire Rat', classification: 'minion', hp: 250,
      resistance_modifier: 1, enemy_weight: '0.50',
      traits: [{ name: 'Pack Hunter', description: 'For each Dire Rat present beyond the first, gains +1 to its damage multiplier.' }],
      description: 'An oversized rat twisted by dark energy. Surprisingly quick and aggressive.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 1, damage_multiplier: 2,  max_pool_contribution: 4  },
        { tier_name: 'Standard', pressure_steps: 2, damage_multiplier: 4,  max_pool_contribution: 6  },
      ],
    },

    // ── STANDARD ──────────────────────────────────────────────────────────
    {
      name: 'Bandit', classification: 'standard', hp: 2000,
      resistance_modifier: 1, enemy_weight: '1.00',
      traits: [],
      description: 'A hardened brigand who fights dirty and prioritises targets that look vulnerable.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 2, damage_multiplier: 8,  max_pool_contribution: 15 },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 12, max_pool_contribution: 22 },
        { tier_name: 'Full',     pressure_steps: 4, damage_multiplier: 18, max_pool_contribution: 30 },
      ],
    },
    {
      name: 'Orc Warrior', classification: 'standard', hp: 3000,
      resistance_modifier: 1, enemy_weight: '1.00',
      traits: [{ name: 'Brute Force', description: 'When using a Full tier attack, adds +2 to damage multiplier.' }],
      description: 'A powerful orcish fighter armed with heavy weapons. Favours aggressive full attacks.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 2, damage_multiplier: 10, max_pool_contribution: 18 },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 15, max_pool_contribution: 26 },
        { tier_name: 'Full',     pressure_steps: 4, damage_multiplier: 22, max_pool_contribution: 36 },
      ],
    },
    {
      name: 'Wolf', classification: 'standard', hp: 1800,
      resistance_modifier: 1, enemy_weight: '1.00',
      traits: [{ name: 'Pounce', description: 'If the wolf has not attacked this round, its Full attack may apply Grappled on a failed save.' }],
      description: 'A large predatory wolf. Fast and aggressive, with a tendency to target isolated prey.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 2, damage_multiplier: 6,  max_pool_contribution: 12 },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 10, max_pool_contribution: 18 },
        { tier_name: 'Full',     pressure_steps: 4, damage_multiplier: 15, max_pool_contribution: 24 },
      ],
    },
    {
      name: 'Cultist Mage', classification: 'standard', hp: 1600,
      resistance_modifier: 0, enemy_weight: '1.00',
      traits: [{ name: 'Spell Strike', description: 'Cultist Mage attacks bypass the Pressure Step save — they deal damage automatically, reduced only by elemental resistance.' }],
      description: 'A mage sworn to a dark patron. Uses Spell Strike to bypass defensive saves with elemental damage.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 2, damage_multiplier: 7,  max_pool_contribution: 12 },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 11, max_pool_contribution: 18 },
        { tier_name: 'Full',     pressure_steps: 4, damage_multiplier: 16, max_pool_contribution: 26 },
      ],
    },
    {
      name: 'Mercenary Guard', classification: 'standard', hp: 2500,
      resistance_modifier: 2, enemy_weight: '1.00',
      traits: [],
      description: 'A professional soldier in light plate. Higher resistance than average — reliable on saves.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 2, damage_multiplier: 9,  max_pool_contribution: 16 },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 13, max_pool_contribution: 22 },
        { tier_name: 'Full',     pressure_steps: 4, damage_multiplier: 19, max_pool_contribution: 30 },
      ],
    },

    // ── ELITE ─────────────────────────────────────────────────────────────
    {
      name: 'Elite Guard', classification: 'elite', hp: 9000,
      resistance_modifier: 3, enemy_weight: '2.00',
      traits: [{ name: 'Ironwall', description: 'If this enemy generates Defensive Steps in a round, they are treated as one step higher than rolled.' }],
      description: 'A heavily armoured veteran soldier of exceptional skill. Absorbs damage and punishes committed attackers.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 2, damage_multiplier: 15, max_pool_contribution: 30 },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 22, max_pool_contribution: 42 },
        { tier_name: 'Full',     pressure_steps: 5, damage_multiplier: 32, max_pool_contribution: 55 },
      ],
    },
    {
      name: 'Vampire Thrall', classification: 'elite', hp: 8000,
      resistance_modifier: 2, enemy_weight: '2.00',
      traits: [
        { name: 'Bloodthirst', description: 'On a Full tier attack that hits, heals for 15% of damage dealt.' },
        { name: 'Shadow Shroud', description: 'Immune to Frightened. Resistant to Shadow damage (50%).' },
      ],
      description: 'A partially-turned thrall of a vampire lord. Drains life on powerful strikes and resists shadow energy.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 2, damage_multiplier: 14, max_pool_contribution: 26 },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 20, max_pool_contribution: 36 },
        { tier_name: 'Full',     pressure_steps: 5, damage_multiplier: 30, max_pool_contribution: 50 },
      ],
    },
    {
      name: 'Stone Golem', classification: 'elite', hp: 12000,
      resistance_modifier: 2, enemy_weight: '2.00',
      traits: [
        { name: 'Stone Body', description: 'Immune to Bleeding, Poisoned, and Charmed. Physical mitigation treated as +20% for damage resolution.' },
        { name: 'Slow', description: 'Cannot use Full tier attack two rounds in a row.' },
      ],
      description: 'A constructed guardian of animated stone. Nearly immune to conventional damage types, but slow and predictable.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 1, damage_multiplier: 16, max_pool_contribution: 28 },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 25, max_pool_contribution: 42 },
        { tier_name: 'Full',     pressure_steps: 4, damage_multiplier: 38, max_pool_contribution: 60 },
      ],
    },

    // ── BOSSES ────────────────────────────────────────────────────────────
    {
      name: 'Troll Warchief', classification: 'boss', hp: 30000,
      resistance_modifier: 3, enemy_weight: '4.00',
      traits: [
        { name: 'Regeneration', description: 'At the start of each enemy turn, recovers 500 HP. Regeneration is suppressed for one round when struck by fire or acid damage.' },
        { name: 'Crushing Blow', description: 'Full tier attacks apply Vulnerable on a failed save.' },
      ],
      description: 'A massive troll who has survived enough battles to command lesser creatures. Regenerates constantly unless scorched.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 2, damage_multiplier: 25,  max_pool_contribution: 50  },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 38,  max_pool_contribution: 72  },
        { tier_name: 'Full',     pressure_steps: 5, damage_multiplier: 58,  max_pool_contribution: 100 },
      ],
    },
    {
      name: 'Lich Archon', classification: 'boss', hp: 50000,
      resistance_modifier: 4, enemy_weight: '5.00',
      traits: [
        { name: 'Undying', description: 'The first time this enemy reaches 0 HP per encounter, it is reduced to 1 HP instead. Phylactery must be destroyed separately.' },
        { name: 'Spell Immunity', description: 'Immune to Silenced. Elemental resistance: Shadow 80%, Arcane 50%, Light −50% (takes increased Light damage).' },
        { name: 'Necrotic Aura', description: 'Any character ending their turn within melee range applies the Bleeding state to themselves.' },
      ],
      description: 'An ancient undead sorcerer of terrifying power. Resists death itself and punishes those who approach.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 2, damage_multiplier: 35,  max_pool_contribution: 80  },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 55,  max_pool_contribution: 110 },
        { tier_name: 'Full',     pressure_steps: 5, damage_multiplier: 80,  max_pool_contribution: 150 },
      ],
    },
    {
      name: 'Young Dragon', classification: 'boss', hp: 40000,
      resistance_modifier: 3, enemy_weight: '4.50',
      traits: [
        { name: 'Fire Breath', description: 'Once per round, may deal automatic fire damage to all player characters equal to Standard tier multiplier × 2d6. No Pressure Steps — treated as Spell Strike.' },
        { name: 'Wing Buffet', description: 'On a Full tier attack that hits, may knock the target Restrained for one round.' },
        { name: 'Fire Immunity', description: 'Immune to fire damage. Resistant to Lightning 30%.' },
      ],
      description: 'A dragon not yet at full maturity but already terrifyingly powerful. Breathes fire as a bonus action and covers distance rapidly.',
      tiers: [
        { tier_name: 'Partial',  pressure_steps: 2, damage_multiplier: 28,  max_pool_contribution: 60  },
        { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 42,  max_pool_contribution: 85  },
        { tier_name: 'Full',     pressure_steps: 5, damage_multiplier: 65,  max_pool_contribution: 120 },
      ],
    },
  ];

  for (const def of enemyDefs) {
    const [enemy] = await db.insert(enemies).values({
      name:                def.name,
      classification:      def.classification,
      hp:                  BigInt(def.hp),
      resistance_modifier: def.resistance_modifier,
      enemy_weight:        def.enemy_weight,
      traits:              def.traits,
      description:         def.description,
      ...official,
      version: 1,
    }).returning();

    await db.insert(enemyAttackTiers).values(
      def.tiers.map((t) => ({
        enemy_id:              enemy.id,
        tier_name:             t.tier_name,
        pressure_steps:        t.pressure_steps,
        damage_multiplier:     t.damage_multiplier,
        max_pool_contribution: t.max_pool_contribution,
      }))
    );
  }

  console.log('  ✓ Enemies seeded');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nVelion Mythera — Library Seed\n');

  try {
    await seedWeapons();
    await seedArmor();
    await seedSpellGems();
    await seedFocusBracers();
    await seedEnemies();
    console.log('\n✅ Seed complete.\n');
  } catch (err) {
    console.error('\n❌ Seed failed:', err);
    process.exit(1);
  }

  process.exit(0);
}

main();