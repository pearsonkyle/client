import { lua_State, lua_pushnumber, lua_pushstring } from '../lua';

// A `return 0` stub pushes no Lua values, which reads as nil at the call site. The
// options panels do arithmetic on driver counts and string work on driver names, so
// those have to return real values even when there is nothing to report.
const pushCount = (L: lua_State) => {
  lua_pushnumber(L, 1);
  return 1;
};

const pushDriverName = (L: lua_State) => {
  lua_pushstring(L, 'Browser');
  return 1;
};

export const PlaySound = () => {
  return 0;
};

export const PlayMusic = () => {
  return 0;
};

export const PlaySoundFile = () => {
  return 0;
};

export const StopMusic = () => {
  return 0;
};

export const Sound_GameSystem_GetNumInputDrivers = pushCount;

export const Sound_GameSystem_GetInputDriverNameByIndex = pushDriverName;

export const Sound_GameSystem_GetNumOutputDrivers = pushCount;

export const Sound_GameSystem_GetOutputDriverNameByIndex = pushDriverName;

export const Sound_GameSystem_RestartSoundSystem = () => {
  return 0;
};

export const Sound_ChatSystem_GetNumInputDrivers = pushCount;

export const Sound_ChatSystem_GetInputDriverNameByIndex = pushDriverName;

export const Sound_ChatSystem_GetNumOutputDrivers = pushCount;

export const Sound_ChatSystem_GetOutputDriverNameByIndex = pushDriverName;

export const VoiceChat_StartCapture = () => {
  return 0;
};

export const VoiceChat_StopCapture = () => {
  return 0;
};

export const VoiceChat_RecordLoopbackSound = () => {
  return 0;
};

export const VoiceChat_StopRecordingLoopbackSound = () => {
  return 0;
};

export const VoiceChat_PlayLoopbackSound = () => {
  return 0;
};

export const VoiceChat_StopPlayingLoopbackSound = () => {
  return 0;
};

export const VoiceChat_IsRecordingLoopbackSound = () => {
  return 0;
};

export const VoiceChat_IsPlayingLoopbackSound = () => {
  return 0;
};

export const VoiceChat_GetCurrentMicrophoneSignalLevel = () => {
  return 0;
};

export const VoiceChat_ActivatePrimaryCaptureCallback = () => {
  return 0;
};
