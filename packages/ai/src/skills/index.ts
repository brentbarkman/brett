import { SkillRegistry } from "./registry.js";

// Items & Tasks
import { createTaskSkill } from "./create-task.js";
import { createContentSkill } from "./create-content.js";
import { updateItemSkill } from "./update-item.js";
import { completeTaskSkill } from "./complete-task.js";
import { searchThingsSkill } from "./search-things.js";
import { getItemDetailSkill } from "./get-item-detail.js";
import { moveToListSkill } from "./move-to-list.js";
import { snoozeItemSkill } from "./snooze-item.js";

// Lists & Organization
import { listTodaySkill } from "./list-today.js";
import { listUpcomingSkill } from "./list-upcoming.js";
import { listInboxSkill } from "./list-inbox.js";
import { getListItemsSkill } from "./get-list-items.js";
import { createListSkill } from "./create-list.js";
import { archiveListSkill } from "./archive-list.js";

// Calendar
import { getCalendarEventsSkill } from "./get-calendar-events.js";
import { getNextEventSkill } from "./get-next-event.js";

// Brett Intelligence
import { morningBriefingSkill } from "./morning-briefing.js";
import { brettsTakeSkill } from "./bretts-take.js";
import { upNextSkill } from "./up-next.js";
import { recallMemorySkill } from "./recall-memory.js";

// Meta / System
import { changeSettingsSkill } from "./change-settings.js";
import { submitFeedbackSkill } from "./submit-feedback.js";
import { explainFeatureSkill } from "./explain-feature.js";
import { getStatsSkill } from "./get-stats.js";

// MCP
import { getMeetingNotesSkill } from "./get-meeting-notes.js";

export function createRegistry(): SkillRegistry {
  const registry = new SkillRegistry();

  // Items & Tasks (8)
  registry.register(createTaskSkill);
  registry.register(createContentSkill);
  registry.register(updateItemSkill);
  registry.register(completeTaskSkill);
  registry.register(searchThingsSkill);
  registry.register(getItemDetailSkill);
  registry.register(moveToListSkill);
  registry.register(snoozeItemSkill);

  // Lists & Organization (6)
  registry.register(listTodaySkill);
  registry.register(listUpcomingSkill);
  registry.register(listInboxSkill);
  registry.register(getListItemsSkill);
  registry.register(createListSkill);
  registry.register(archiveListSkill);

  // Calendar (2)
  registry.register(getCalendarEventsSkill);
  registry.register(getNextEventSkill);

  // Brett Intelligence (4)
  // Registered when functional — placeholder skills pollute the tool list and confuse routing
  // registry.register(morningBriefingSkill);
  // registry.register(brettsTakeSkill);
  registry.register(upNextSkill);
  // registry.register(recallMemorySkill);

  // Meta / System (4)
  registry.register(changeSettingsSkill);
  registry.register(submitFeedbackSkill);
  registry.register(explainFeatureSkill);
  registry.register(getStatsSkill);

  // MCP (1)
  // Registered when functional — placeholder skills pollute the tool list and confuse routing
  // registry.register(getMeetingNotesSkill);

  return registry;
}
