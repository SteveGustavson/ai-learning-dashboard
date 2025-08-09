import React, { useState, useEffect, useRef } from 'react';
import {
  Textarea,
  Button,
  Avatar,
  Text,
  tokens
} from '@fluentui/react-components';

export default function ChatPanel({ resource, dark }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const listRef = useRef();

  // Reset thread when resource changes
  useEffect(() => {
    if (resource) setMessages([{ role: 'system', content: `Context: ${resource.title}` }]);
    else setMessages([]);
  }, [resource]);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: resource ? resource.id : null,
          message: userMsg.content
        }),
      });
      const data = await resp.json();
      const reply = data?.reply?.content || ('Error: ' + (data?.error || 'unknown'));
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      });
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Chat failed: ' + err.message }]);
    }
  };

  // Accessible bubble colors (AA contrast)
  const colors = dark
    ? {
        surface: '#1f1f1f',
        assistantBg: '#2b2b2b',
        assistantFg: '#e6e6e6',
        userBg: '#0b6bc2',         // Fluent blue 60ish
        userFg: '#ffffff',
        hint: '#9aa0a6',
        divider: '#2e2e2e',
        rail: '#121212'
      }
    : {
        surface: '#ffffff',
        assistantBg: '#f3f4f6',    // ≈ #111 text for 4.5:1+
        assistantFg: '#111111',
        userBg: '#115ea3',         // Fluent blue 70
        userFg: '#ffffff',
        hint: '#5f6368',
        divider: '#e1e4ea',
        rail: '#fafafa'
      };

  return (
    // Full-height column layout; overflow managed inside
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: colors.rail
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
        <Avatar name="AI" />
        <div>
          <Text weight="semibold">AI Chat Assistant</Text>
          <div style={{ fontSize: 12, color: colors.hint }}>
            {resource ? 'Ask about the selected resource' : 'Pick a resource to start'}
          </div>
        </div>
      </div>

      {/* Messages list */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          minHeight: 0,                // critical: allows the flex child to scroll instead of overflow
          overflowY: 'auto',
          padding: '8px 4px 12px 0'
        }}
      >
        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={i}
              style={{
                marginBottom: 10,
                display: 'flex',
                flexDirection: isUser ? 'row-reverse' : 'row',
                gap: 8
              }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  background: isUser ? colors.userBg : colors.assistantBg,
                  color: isUser ? colors.userFg : colors.assistantFg,
                  padding: 10,
                  borderRadius: 12,
                  lineHeight: 1.35,
                  boxShadow: isUser
                    ? '0 1px 0 rgba(0,0,0,0.06)'
                    : 'inset 0 0 0 1px rgba(0,0,0,0.04)'
                }}
              >
                <div style={{ fontSize: 13 }}>{m.content}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky composer */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: colors.rail,
          paddingTop: 8,
          paddingBottom: 8
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <Textarea
            value={input}
            onChange={(_, data) => setInput(data.value)}
            placeholder="Ask GPT about this resource..."
            style={{ flex: 1 }}
          />
          <Button appearance="primary" onClick={send}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
