import { useEffect } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AppShell } from './shell/AppShell';
import { Showcase } from './screens/Showcase';
import { Placeholder } from './screens/Placeholder';
import { ChatScreen } from './screens/chat/ChatScreen';
import { coreClient } from '../lib/coreClient';
import { useShell, MODULES, DESIGN_MODULE } from '../lib/store';
import { toast } from '../ui';

function ActiveScreen() {
  const active = useShell((s) => s.active);
  if (active === 'design') return <Showcase />;
  if (active === 'chat') return <ChatScreen />;
  const meta = MODULES.find((m) => m.id === active) ?? DESIGN_MODULE;
  return <Placeholder meta={meta} />;
}

export default function App(): JSX.Element {
  useEffect(() => {
    coreClient.health().catch(() => {
      toast({
        tone: 'danger',
        title: 'Core engine unreachable',
        description: 'The local core server did not respond. Voice and chat will be unavailable.',
        action: { label: 'Retry', onClick: () => window.location.reload() },
      });
    });
  }, []);

  return (
    <ThemeProvider>
      <AppShell>
        <ActiveScreen />
      </AppShell>
    </ThemeProvider>
  );
}
