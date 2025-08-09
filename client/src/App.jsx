import React, { useEffect, useState } from 'react';
import { Button, Card, Text, Switch } from '@fluentui/react-components';
import ChatPanel from './ChatPanel';

export default function App({ dark, setDark }) {
  const [resources, setResources] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetch('/api/resources')
      .then(r => r.json())
      .then(j => setResources(j.resources || []))
      .catch(() => setResources([]));
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        gap: 16,
        padding: 24,
        background: dark ? '#1e1e1e' : '#f3f4f6',
        color: dark ? '#ffffff' : '#000000'
      }}
    >
      {/* Left rail */}
      <div style={{ width: 320, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <h2 style={{ margin: 0, marginBottom: 8 }}>AI Learning Dashboard</h2>

        <div style={{ marginBottom: 12 }}>
          <Switch
            checked={dark}
            onChange={(_, data) => setDark(data.checked)}
            label={dark ? 'Dark Mode' : 'Light Mode'}
          />
        </div>

        {/* Scrollable list */}
        <div style={{ overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
          {resources.map(r => (
            <Card key={r.id} style={{ marginBottom: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <Text weight="semibold">{r.title}</Text>
                  <div style={{ fontSize: 12, color: dark ? '#cfcfcf' : '#6b7280' }}>
                    {r.track} • {r.level}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <Button appearance="primary" onClick={() => setSelected(r)}>
                    Open
                  </Button>
                  {r.url && (
                    <Button as="a" href={r.url} target="_blank" rel="noreferrer">
                      Read
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
          {resources.length === 0 && (
            <div style={{ color: dark ? '#9aa0a6' : '#6b7280' }}>
              No items yet. Try refreshing in a minute or check server logs.
            </div>
          )}
        </div>
      </div>

      {/* Center content */}
      <div style={{ flex: 1, padding: 12, minWidth: 0 }}>
        {selected ? (
          <>
            <h3 style={{ marginTop: 4, marginBottom: 6 }}>{selected.title}</h3>
            <div style={{ color: dark ? '#dddddd' : '#374151', whiteSpace: 'pre-wrap' }}>
              {selected.summary}
            </div>
          </>
        ) : (
          <div style={{ color: dark ? '#888888' : '#6b7280' }}>
            Select a resource to open the chat assistant.
          </div>
        )}
      </div>

      {/* High-contrast vertical divider */}
      <div
        aria-hidden="true"
        style={{
          width: 1,
          alignSelf: 'stretch',
          background: dark ? '#2e2e2e' : '#e1e4ea',
          boxShadow: dark ? '0 0 0 1px #2e2e2e' : '0 0 0 1px #e1e4ea'
        }}
      />

      {/* Right rail (chat) */}
      <div style={{ width: 420, paddingLeft: 12, height: '100%', minHeight: 0 }}>
        <ChatPanel resource={selected} dark={dark} />
      </div>
    </div>
  );
}
