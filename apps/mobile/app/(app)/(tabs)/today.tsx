import { useState, useEffect, useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LivingBackground } from '../../../src/components/LivingBackground';
import { HeaderStats } from '../../../src/components/HeaderStats';
import { DailyBriefing } from '../../../src/components/DailyBriefing';
import { NextUpCard } from '../../../src/components/NextUpCard';
import { SectionHeader } from '../../../src/components/SectionHeader';
import { TaskRow } from '../../../src/components/TaskRow';
import { Omnibar } from '../../../src/components/Omnibar';
import { MultiSelectToolbar } from '../../../src/components/MultiSelectToolbar';
import { MorningRitual } from '../../../src/components/MorningRitual';
import { useBatchCompletion } from '../../../src/hooks/use-batch-completion';
import { useMorningRitual } from '../../../src/hooks/use-morning-ritual';
import {
  useMockItems,
  useMockCalendarEvents,
  useMockBriefing,
  useTodayStats,
  type MockItem,
} from '../../../src/mock/hooks';
import { getListForItem } from '../../../src/mock/data';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDueLabel(item: MockItem): string | undefined {
  if (!item.dueDate) return undefined;
  const date = new Date(item.dueDate);
  const hours = date.getHours();
  // If time is midnight or 9am (the default placeholder times in mock data),
  // return a period label instead of a clock time
  if (hours === 0) return undefined;
  if (hours < 12) return `${hours}:${date.getMinutes().toString().padStart(2, '0')} AM`;
  if (hours === 12) return `12:${date.getMinutes().toString().padStart(2, '0')} PM`;
  const pmHour = hours - 12;
  const mins = date.getMinutes().toString().padStart(2, '0');
  if (hours >= 17) return 'Evening';
  if (hours >= 12) return `${pmHour}:${mins} PM`;
  return undefined;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TodayScreen() {
  const router = useRouter();
  const shouldAnimate = useMorningRitual();
  const { todayItems, toggleItem, createItem } = useMockItems();
  const { nextEvent } = useMockCalendarEvents();
  const { content, generatedAt, isCollapsed, isDismissed, toggleCollapse, dismiss } =
    useMockBriefing();
  const { totalToday, doneToday, meetingCount, meetingDuration } = useTodayStats(todayItems);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleDoneSelecting = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Batch completion: prevents list reflow while rapidly toggling multiple items
  const { batchToggle, shouldReflow } = useBatchCompletion(toggleItem);

  // Snapshot items when batch mode starts so toggled tasks stay in their current
  // section (with done visual style) until the reflow timer fires.
  const [snapshotItems, setSnapshotItems] = useState<MockItem[] | null>(null);

  useEffect(() => {
    if (!shouldReflow && snapshotItems === null) {
      // Entering batch mode — freeze current positions
      setSnapshotItems([...todayItems]);
    } else if (shouldReflow && snapshotItems !== null) {
      // Reflow triggered — clear snapshot and let live data take over
      setSnapshotItems(null);
    }
  }, [shouldReflow]);

  // Use the snapshot while batch mode is active, otherwise use live data
  const displayItems = snapshotItems ?? todayItems;

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  // Group items by urgency / status — use displayItems so snapshot prevents reflow
  const overdue = displayItems.filter(i => i.urgency === 'overdue' && i.status === 'active');
  const overdoneInOverdue = displayItems.filter(i => i.urgency === 'overdue' && i.status === 'done');
  const todayActive = displayItems.filter(i => i.urgency === 'today' && i.status === 'active');
  const todayDoneInSection = displayItems.filter(i => i.urgency === 'today' && i.status === 'done');
  const thisWeek = displayItems.filter(i => i.urgency === 'this_week' && i.status === 'active');
  const thisWeekDoneInSection = displayItems.filter(i => i.urgency === 'this_week' && i.status === 'done');
  // Items that were in Done Today when snapshot was taken, or completed items with no urgency bucket
  const doneToday2 = displayItems.filter(i => i.status === 'done' && i.urgency === null)
    .concat(snapshotItems === null ? displayItems.filter(i => i.status === 'done' && i.urgency !== null) : []);

  const isSelecting = selectedIds.size > 0;

  return (
    <View style={{ flex: 1 }}>
      <LivingBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <MorningRitual enabled={shouldAnimate}>
          <HeaderStats
            date={dateStr}
            doneCount={doneToday}
            totalCount={totalToday}
            meetingCount={meetingCount}
            meetingDuration={meetingDuration}
          />

          <View style={{ paddingHorizontal: 16 }}>
            <DailyBriefing
              content={content}
              generatedAt={generatedAt}
              isCollapsed={isCollapsed}
              isDismissed={isDismissed}
              toggleCollapse={toggleCollapse}
              dismiss={dismiss}
            />

            {nextEvent && (
              <NextUpCard event={nextEvent} onPress={() => {}} />
            )}
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {(overdue.length > 0 || overdoneInOverdue.length > 0) && (
              <>
                <SectionHeader label="Overdue" variant="overdue" />
                {overdue.map(item => (
                  <TaskRow
                    key={item.id}
                    id={item.id}
                    title={item.title}
                    isDone={false}
                    isOverdue
                    dueLabel={formatDueLabel(item)}
                    listName={getListForItem(item)?.name}
                    isSelected={selectedIds.has(item.id)}
                    onToggle={() => batchToggle(item.id)}
                    onPress={() => router.push(`/task/${item.id}`)}
                    onSelect={() => handleSelect(item.id)}
                  />
                ))}
                {overdoneInOverdue.map(item => (
                  <TaskRow
                    key={item.id}
                    id={item.id}
                    title={item.title}
                    isDone
                    isOverdue
                    dueLabel={formatDueLabel(item)}
                    listName={getListForItem(item)?.name}
                    isSelected={selectedIds.has(item.id)}
                    onToggle={() => batchToggle(item.id)}
                    onPress={() => router.push(`/task/${item.id}`)}
                    onSelect={() => handleSelect(item.id)}
                  />
                ))}
              </>
            )}

            {(todayActive.length > 0 || todayDoneInSection.length > 0) && (
              <>
                <SectionHeader label="Today" />
                {todayActive.map(item => (
                  <TaskRow
                    key={item.id}
                    id={item.id}
                    title={item.title}
                    isDone={false}
                    dueLabel={formatDueLabel(item)}
                    listName={getListForItem(item)?.name}
                    isSelected={selectedIds.has(item.id)}
                    onToggle={() => batchToggle(item.id)}
                    onPress={() => router.push(`/task/${item.id}`)}
                    onSelect={() => handleSelect(item.id)}
                  />
                ))}
                {todayDoneInSection.map(item => (
                  <TaskRow
                    key={item.id}
                    id={item.id}
                    title={item.title}
                    isDone
                    dueLabel={formatDueLabel(item)}
                    listName={getListForItem(item)?.name}
                    isSelected={selectedIds.has(item.id)}
                    onToggle={() => batchToggle(item.id)}
                    onPress={() => router.push(`/task/${item.id}`)}
                    onSelect={() => handleSelect(item.id)}
                  />
                ))}
              </>
            )}

            {(thisWeek.length > 0 || thisWeekDoneInSection.length > 0) && (
              <>
                <SectionHeader label="This Week" />
                {thisWeek.map(item => (
                  <TaskRow
                    key={item.id}
                    id={item.id}
                    title={item.title}
                    isDone={false}
                    dueLabel={formatDueLabel(item)}
                    listName={getListForItem(item)?.name}
                    isSelected={selectedIds.has(item.id)}
                    onToggle={() => batchToggle(item.id)}
                    onPress={() => router.push(`/task/${item.id}`)}
                    onSelect={() => handleSelect(item.id)}
                  />
                ))}
                {thisWeekDoneInSection.map(item => (
                  <TaskRow
                    key={item.id}
                    id={item.id}
                    title={item.title}
                    isDone
                    dueLabel={formatDueLabel(item)}
                    listName={getListForItem(item)?.name}
                    isSelected={selectedIds.has(item.id)}
                    onToggle={() => batchToggle(item.id)}
                    onPress={() => router.push(`/task/${item.id}`)}
                    onSelect={() => handleSelect(item.id)}
                  />
                ))}
              </>
            )}

            {doneToday2.length > 0 && (
              <>
                <SectionHeader label="Done Today" variant="done" />
                {doneToday2.map(item => (
                  <TaskRow
                    key={item.id}
                    id={item.id}
                    title={item.title}
                    isDone
                    dueLabel={formatDueLabel(item)}
                    listName={getListForItem(item)?.name}
                    isSelected={selectedIds.has(item.id)}
                    onToggle={() => batchToggle(item.id)}
                    onPress={() => router.push(`/task/${item.id}`)}
                    onSelect={() => handleSelect(item.id)}
                  />
                ))}
              </>
            )}
          </ScrollView>

          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <Omnibar
              onSubmit={(text) => createItem(text, new Date().toISOString(), null)}
            />
          </View>
        </MorningRitual>
      </SafeAreaView>

      <MultiSelectToolbar
        selectedCount={selectedIds.size}
        visible={isSelecting}
        onSchedule={() => {
          // TODO: open schedule picker for selected items
          handleDoneSelecting();
        }}
        onMoveToList={() => {
          // TODO: open list picker for selected items
          handleDoneSelecting();
        }}
        onDelete={() => {
          // TODO: delete selected items
          handleDoneSelecting();
        }}
        onDone={handleDoneSelecting}
      />
    </View>
  );
}
