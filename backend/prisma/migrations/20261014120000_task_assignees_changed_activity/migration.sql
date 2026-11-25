-- Histórico do conjunto de responsáveis da task (from/to = ids separados por vírgula): o tempo da task conta para todos.
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'assignees_changed';
