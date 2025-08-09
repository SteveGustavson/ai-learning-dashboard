import React, { useState, useEffect, useRef } from 'react';
import { TextArea, Button, Avatar, Text } from '@fluentui/react-components';

export default function ChatPanel({ resource, dark }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const listRef = useRef();

  useEffect(() => {
    if (resource) setMessages([{ role: 'system', content: `Context: ${resource.title}` }]);
  }, [resource]);

  const send = async () => {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setInput('');
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceId: resource?.id, message: input })
    });
    const data = await resp.json();
    setMessages(prev => [...prev, { role: 'assistant', content: data.reply.content }]);
    listRef.current.scrollTop = listRef.current.scrollHeight;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Avatar name="AI" />
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', marginTop: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ background: m.role === 'assistant' ? '#333' : '#005a9e', color: '#fff', padding: 8, borderRadius: 4, margin: '4px 0' }}>
            {m.content}
          </div>
        ))}
      </div>
      <TextArea value={input} onChange={e => setInput(e.target.value)} placeholder="Ask GPT..." />
      <Button appearance="primary" onClick={send} style={{ marginTop: 4 }}>Send</Button>
    </div>
  );
}
