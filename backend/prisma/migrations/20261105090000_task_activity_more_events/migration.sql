-- Histórico da task: eventos que antes não ficavam registrados (tags, dependências, chamados, anexos, início e subtasks).
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'tag_changed';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'dependency_changed';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'ticket_changed';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'attachment_changed';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'start_date_changed';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'subtask_added';
