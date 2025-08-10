import React, { useState, useEffect, useRef } from 'react';
import { Textarea, Button, Avatar, Text } from '@fluentui/react-components';

export default function ChatPanel({ resource, dark }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const listRef = useRef();

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
        body: JSON.stringify({ resourceId: resource ? resource.id : null, message: input }),
      });

      const data = await resp.json();
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply.content }]);
      } else {
        const details = (data.details || '').toString().slice(0, 400);
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: `Error: ${data.error || 'unknown'}\n${details}` },
        ]);
      }
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Chat failed: ' + err.message }]);
    }
  };

  return (
    <div style={{height:'100%', display:'flex', flexDirection:'column'}}>
      <div style={{display:'flex', alignItems:'center', gap:12}}>
        <Avatar name="AI" />
        <div>
          <Text weight="semibold">AI Chat Assistant</Text>
          <div style={{fontSize:12, color: dark ? '#888' : '#4b5563'}}>Ask anything while you read</div>
        </div>
      </div>

      <div
        ref={listRef}
        style={{flex:1, marginTop:12, overflowY:'auto', paddingRight:8}}
      >
        {messages.map((m, i) => (
          <div key={i} style={{marginBottom:10, display:'flex', flexDirection: m.role==='user' ? 'row-reverse':'row', gap:8}}>
            <div
              style={{
                maxWidth:'75%',
                background: m.role==='assistant'
                  ? (dark ? '#2b2b2b' : '#f3f4f6')
                  : (dark ? '#0b61a4' : '#0b61a4'),
                padding:10,
                borderRadius:10,
                color: m.role==='assistant' ? (dark ? '#e5e7eb' : '#111827') : '#ffffff',
                border: `1px solid ${dark ? '#3a3a3a' : '#d1d5db'}`
              }}
            >
              <div style={{fontSize:14, lineHeight:1.45, whiteSpace:'pre-wrap'}}>{m.content}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{display:'flex', gap:8, marginTop:12}}>
        <Textarea
          value={input}
          onChange={(_, data) => setInput(data.value)}
          placeholder="Ask GPT about this topic…"
          style={{flex:1}}
        />
        <Button appearance="primary" onClick={send}>Send</Button>
      </div>
    </div>
  );
}
