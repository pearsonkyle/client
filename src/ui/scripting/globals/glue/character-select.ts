import { lua_State, lua_pushstring, lua_tonumber } from '../../lua';

import { session } from '../../../../game/GameSession';
import { Race } from '../../../../net/world/types';

/** Race to the glue background model folder under Interface\Glues\Models. */
const BACKGROUND_MODELS: Record<number, string> = {
  [Race.HUMAN]: 'Human',
  [Race.ORC]: 'Orc',
  [Race.DWARF]: 'Dwarf',
  [Race.NIGHT_ELF]: 'NightElf',
  [Race.UNDEAD]: 'Scourge',
  [Race.TAUREN]: 'Tauren',
  // No gnome or troll glue model ships; they share their faction partner's screen.
  [Race.GNOME]: 'Dwarf',
  [Race.TROLL]: 'Orc',
  [Race.BLOOD_ELF]: 'BloodElf',
  [Race.DRAENEI]: 'Draenei',
};

const backgroundModelFor = (race: number): string => BACKGROUND_MODELS[race] ?? 'CharacterSelect';

export const SetCharSelectModelFrame = () => {
  return 0;
};

export const SetCharSelectBackground = () => {
  return 0;
};






export const RenameCharacter = () => {
  return 0;
};

export const DeclineCharacter = () => {
  return 0;
};

export const UpdateSelectionCustomizationScene = () => {
  return 0;
};



export const GetSelectBackgroundModel = (L: lua_State) => {
  // GlueParent.SetBackgroundModel builds `Interface\Glues\Models\UI_<name>\UI_<name>.m2`
  // from this and calls strupper() on it, so returning nil throws before the character
  // screen can even show. The names match the folders that actually exist in the MPQs.
  const index = (lua_tonumber(L, 1) ?? 1) - 1;
  const character = session.characters[index];
  lua_pushstring(L, character ? backgroundModelFor(character.race) : 'CharacterSelect');
  return 1;
};
