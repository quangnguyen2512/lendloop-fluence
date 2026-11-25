"use client";

import { AlertTriangle, Bell, CheckCircle2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/domain";
import type { AutomationActivity } from "@/lib/types";

interface ActivityFeedProps {
  items: AutomationActivity[];
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  if (!items || items.length === 0) {
    return (
      <div className="activity-box">
        <span className="activity-title">Automation Activity</span>
        <span className="activity-time">
          No automation events recorded on this loan yet.
        </span>
      </div>
    );
  }

  return (
    <div className="activity-box">
      <span className="activity-title">Recent Automation Activity</span>
      {items.map((item) => {
        const icon =
          item.eventType === "overdue_reminder_sent" ? (
            <Bell size={14} aria-hidden="true" />
          ) : item.eventType === "automation_error" ? (
            <AlertTriangle size={14} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={14} aria-hidden="true" />
          );

        return (
          <div
            key={item.id}
            className="activity-item"
            title={`Idempotency key: ${item.idempotencyKey} | Channel: ${item.channel}`}
          >
            <span className="activity-left">
              {icon}
              <span>{item.summary}</span>
            </span>
            <span className="activity-time">
              {formatRelativeTime(item.createdAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
