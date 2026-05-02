import api from '@/lib/api';

export type GearSlot =
  | 'main_hand'
  | 'off_hand'
  | 'helmet'
  | 'shirt'
  | 'chestplate'
  | 'pants'
  | 'leggings'
  | 'gauntlets'
  | 'boots'
  | 'bracer';

export type GearChoice = {
  item_type: 'weapon' | 'armor' | 'focus_bracer';
  item_id:   string;
  name:      string;
};

export type StartingGearState = Partial<Record<GearSlot, GearChoice>>;

/**
 * Add each picked library item to the character's bag and equip it (inventory + character_equipment sync).
 */
export async function commitStartingEquipment(
  characterId: string,
  picks: StartingGearState,
): Promise<void> {
  const entries = Object.entries(picks) as [GearSlot, GearChoice][];
  for (const [slot, pick] of entries) {
    if (!pick?.item_id) continue;
    const { data: row } = await api.post<{ id: string }>(`/inventory/${characterId}`, {
      item_type:       pick.item_type,
      library_item_id: pick.item_id,
    });
    await api.patch(`/inventory/${characterId}/${row.id}`, {
      equipped:      true,
      equipped_slot: slot,
    });
  }
}
