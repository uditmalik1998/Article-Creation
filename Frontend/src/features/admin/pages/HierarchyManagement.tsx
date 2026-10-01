/**
 * Hierarchy Management Page
 * Tab 1: Grid Values
 * Tab 2: Size Master
 * Tab 3: Hierarchy — browse dept/sub-dept/category structure
 */
import { useState } from 'react';
import { Network, Download, ListTree, Ruler } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui-tw';
import { HierarchyTreeEditor } from '../components/HierarchyTreeEditor';
import { GridValuesEditor } from '../components/GridValuesEditor';
import { SizeMasterEditor } from '../components/SizeMasterEditor';

type TabType = 'grid-values' | 'size-master' | 'hierarchy';

export default function HierarchyManagement() {
  const [activeTab, setActiveTab] = useState<TabType>('grid-values');

  const handleExport = async () => {
    try {
      const { exportHierarchy } = await import('../../../services/adminApi');
      const blob = await exportHierarchy();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hierarchy-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      console.error('Export failed');
    }
  };

  return (
    <div className="page-scroll-enabled min-h-screen">
      <div className="p-6">
        <div className="mx-auto max-w-[1600px]">
          {/* Header */}
          <Card className="mb-6 glass card-3d rounded-2xl border border-white/60 overflow-hidden">
            <CardContent className="flex items-center justify-between p-6">
              <div>
                <h1 className="m-0 text-2xl font-semibold">Hierarchy Management</h1>
                <p className="text-sm text-muted-foreground">
                  Manage departments, categories &amp; extraction attributes — changes reflect in the app within 5 minutes
                </p>
              </div>
              <Button onClick={handleExport}>
                <Download />
                Export JSON
              </Button>
            </CardContent>
          </Card>

          {/* Tabs */}
          <Card className="glass rounded-2xl border border-white/60 overflow-hidden">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="w-full">
              <div className="border-b border-border px-6">
                <TabsList className="bg-transparent">
                  <TabsTrigger value="grid-values">
                    <ListTree className="mr-1 h-4 w-4" />
                    Grid Values
                  </TabsTrigger>
                  <TabsTrigger value="size-master">
                    <Ruler className="mr-1 h-4 w-4" />
                    Size Master
                  </TabsTrigger>
                  <TabsTrigger value="hierarchy">
                    <Network className="mr-1 h-4 w-4" />
                    Hierarchy
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="grid-values" className="m-0 px-6 py-4">
                <p className="mb-3 text-sm text-muted-foreground">
                  Browse the allowed grid values by <strong>group → attribute → major category</strong>.
                  Click a major category to view, add, or delete the values for that attribute.
                </p>
                <GridValuesEditor />
              </TabsContent>

              <TabsContent value="size-master" className="m-0 px-6 py-4">
                <p className="mb-3 text-sm text-muted-foreground">
                  Browse the active <strong>sizes per major category</strong> from the size master.
                  Click a major category to view, add, or remove its sizes — every change needs a
                  remark and is recorded with your name in the audit log.
                </p>
                <SizeMasterEditor />
              </TabsContent>

              <TabsContent value="hierarchy" className="m-0 px-6 py-4">
                <p className="mb-3 text-sm text-muted-foreground">
                  Browse departments, sub-departments, and categories.
                  Use the <strong>pencil</strong> icon to rename and <strong>trash</strong> to delete.
                </p>
                <HierarchyTreeEditor />
              </TabsContent>

            </Tabs>
          </Card>
        </div>
      </div>
    </div>
  );
}
