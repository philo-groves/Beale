import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  DEFAULT_CHAT_VIEW,
  readChatViewPreference,
  writeChatViewPreference,
  type ChatView
} from '../view-models/chatView';

function initialChatView(): ChatView {
  if (typeof window === 'undefined') return DEFAULT_CHAT_VIEW;
  return readChatViewPreference(window.localStorage);
}

export function useChatViewPreference(): [ChatView, Dispatch<SetStateAction<ChatView>>] {
  const [chatView, setChatView] = useState<ChatView>(initialChatView);

  useEffect(() => {
    writeChatViewPreference(window.localStorage, chatView);
  }, [chatView]);

  return [chatView, setChatView];
}
