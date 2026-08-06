export const AI_ASSISTANT_PERMISSIONS = {
  access: 'ai_assistant.access',
  useReadTools: 'ai_assistant.use_read_tools',
  useWriteTools: 'ai_assistant.use_write_tools',
  confirmActions: 'ai_assistant.confirm_actions',
  viewHistory: 'ai_assistant.view_history',
  manageTools: 'ai_assistant.manage_tools',
} as const;

export const AI_ASSISTANT_PERMISSION_KEYS = Object.values(AI_ASSISTANT_PERMISSIONS);
