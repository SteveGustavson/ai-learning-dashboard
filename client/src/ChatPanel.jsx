import React, { useState, useEffect, useRef } from 'react';
import { Textarea, Button, Avatar, Text } from '@fluentui/react-components';

export default function ChatPanel({ resource, dark }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const chatEndRef = useRef(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Reset when resource changes
  useEffect(() => {
    if (resource) {
      setMessages([
        {
          role: 'assistant',
          content: `Context: ${resource.title}`,
        },
      ]);
    }
  }, [resource]);

  async function send() {
    if (!input.trim()) return;

    // Add the user message locally
    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    const toSend = input;
    setInput('');

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: resource?.id,
          messages: [...messages, { role: 'user', content: toSend }],
        }),
      });

      const data = await resp.json();

      // ✅ Improved error handling
      if (data.reply) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.reply.content },
        ]);
      } else {
        const details = (data.details || '').toString().slice(0, 400);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Error: ${data.error || 'unknown'}\n${details}`,
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}` },
      ]);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderLeft: dark ? '1px solid #333' : '1px solid #ddd',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: 12,
          borderBottom: dark ? '1px solid #333' : '1px solid #ddd',
        }}
      >
        <Text weight="semibold">AI Chat Assistant</Text>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Ask about the selected resource
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          background: dark ? '#111' : '#fafafa',
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: 12,
              display: 'flex',
              flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
              alignItems: 'flex-start',
            }}
          >
            <Avatar
              size={32}
              name={m.role === 'user' ? 'You' : 'AI'}
              color={m.role === 'user' ? 'brand' : 'neutral'}
            />
            <div
              style={{
                marginLeft: m.role === 'user' ? 0 : 8,
                marginRight: m.role === 'user' ? 8 : 0,
                padding: 8,
                background:
                  m.role === 'user'
                    ? dark
                      ? '#2563eb'
                      : '#dbeafe'
                    : dark
                    ? '#1f2937'
                    : '#fff',
                color:
                  m.role === 'user'
                    ? dark
                      ? '#fff'
                      : '#000'
                    : dark
                    ? '#e5e7eb'
                    : '#111',
                borderRadius: 6,
                maxWidth: '75%',
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: 12,
          borderTop: dark ? '1px solid #333' : '1px solid #ddd',
          display: 'flex',
          gap: 8,
        }}
      >
        <TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask GPT about this resource..."
          style={{ flex: 1 }}
          resize="none"
        />
        <Button appearance="primary" onClick={send}>
          Send
        </Button>
      </div>
    </div>
  );
}
