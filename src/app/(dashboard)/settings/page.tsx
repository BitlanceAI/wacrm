'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Settings, Tag, User, Zap, Headphones, IndianRupee, Code2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TagManager } from '@/components/settings/tag-manager';
import { DeveloperPanel } from '@/components/settings/developer-panel';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { CannedReplyManager } from '@/components/settings/canned-reply-manager';
import { SupportDeskPanel } from '@/components/settings/support-desk-panel';
import { BillingPanel } from '@/components/settings/billing-panel';

const TAB_VALUES = [
 'profile',
 'whatsapp',
 'tags',
 'developers',
 'quick-replies',
 'support',
 'billing',
] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
 return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

export default function SettingsPage() {
 const router = useRouter();
 const searchParams = useSearchParams();

 // The URL is the single source of truth for the active tab — no
 // local state, no sync effect. A previous revision duplicated this
 // into `useState` + a sync effect, which tripped React 19's
 // set-state-in-effect rule and was also redundant.
 const queryTab = searchParams.get('tab');
 const tab: TabValue = isTabValue(queryTab) ? queryTab : 'profile';

 // Templates moved to their own sidebar page. Old links (and older
 // error messages saying "Settings → Templates") still resolve.
 useEffect(() => {
 if (queryTab === 'templates') router.replace('/templates');
 }, [queryTab, router]);

 const onChange = (next: TabValue) => {
 const params = new URLSearchParams(searchParams.toString());
 params.set('tab', next);
 router.replace(`/settings?${params.toString()}`, { scroll: false });
 };

 return (
 <div className="space-y-6">
 <div>
 <h1 className="text-2xl font-bold text-foreground">Settings</h1>
 <p className="text-sm text-muted-foreground mt-1">
 Manage your profile, WhatsApp® integration, tags, and inbox quick
 replies. Message templates now live in the sidebar under Templates.
 </p>
 </div>

 <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)}>
 <TabsList className="bg-background border border-border">
 <TabsTrigger
 value="profile"
 className="data-active:bg-accent data-active:text-primary text-muted-foreground"
 >
 <User className="size-4" />
 Profile
 </TabsTrigger>
 <TabsTrigger
 value="whatsapp"
 className="data-active:bg-accent data-active:text-primary text-muted-foreground"
 >
 <Settings className="size-4" />
 WhatsApp Config
 </TabsTrigger>
 <TabsTrigger
 value="tags"
 className="data-active:bg-accent data-active:text-primary text-muted-foreground"
 >
 <Tag className="size-4" />
 Tags
 </TabsTrigger>
 <TabsTrigger
 value="developers"
 className="data-active:bg-accent data-active:text-primary text-muted-foreground"
 >
 <Code2 className="size-4" />
 Developers
 </TabsTrigger>
 <TabsTrigger
 value="quick-replies"
 className="data-active:bg-accent data-active:text-primary text-muted-foreground"
 >
 <Zap className="size-4" />
 Quick Replies
 </TabsTrigger>
 <TabsTrigger
 value="support"
 className="data-active:bg-accent data-active:text-primary text-muted-foreground"
 >
 <Headphones className="size-4" />
 Support Desk
 </TabsTrigger>
 <TabsTrigger
 value="billing"
 className="data-active:bg-accent data-active:text-primary text-muted-foreground"
 >
 <IndianRupee className="size-4" />
 Billing
 </TabsTrigger>
 </TabsList>

 <TabsContent value="profile" className="space-y-6">
 <ProfileForm />
 <PasswordForm />
 <SessionsCard />
 </TabsContent>

 <TabsContent value="whatsapp">
 <WhatsAppConfig />
 </TabsContent>

 <TabsContent value="tags">
 <TagManager />
 </TabsContent>

 <TabsContent value="developers">
 <DeveloperPanel />
 </TabsContent>

 <TabsContent value="quick-replies">
 <CannedReplyManager />
 </TabsContent>

 <TabsContent value="support">
 <SupportDeskPanel />
 </TabsContent>

 <TabsContent value="billing">
 <BillingPanel />
 </TabsContent>
 </Tabs>
 </div>
 );
}
