import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { SurveyController } from '../controllers/survey'

const router = Router()

// --- Public Routes ---
router.get('/public/:token', SurveyController.getSurveyByToken)
router.post('/public/:token', SurveyController.submitSurveyResponse)

// --- Authenticated Routes ---
router.use(authenticate)

router.get('/pending', SurveyController.getPendingSurveys)

// Get active template can be read by agents too (for macros etc.)
router.get('/templates/active', SurveyController.getActiveTemplate)

// Dashboard stats: Admins, Managers and Supervisors or with survey_dashboard permission
router.get('/dashboard', requireCap('survey.dashboard'), SurveyController.getDashboardStats)
router.post('/tickets/:id/resend-email', requireCap('survey.dashboard'), SurveyController.resendSurveyEmail)

// Templates CRUD: Supervisors/Managers/Admins can view, only Admin or with survey permission can edit
router.get('/templates', requireCap('survey.templates.view'), SurveyController.listTemplates)
router.get('/templates/:id', requireCap('survey.templates.view'), SurveyController.getTemplate)

router.post('/templates', requireCap('survey.manage'), SurveyController.createTemplate)
router.put('/templates/:id', requireCap('survey.manage'), SurveyController.updateTemplate)
router.delete('/templates/:id', requireCap('survey.manage'), SurveyController.deleteTemplate)
router.post('/templates/:id/active', requireCap('survey.manage'), SurveyController.setActiveTemplate)

// Question / Option Management (Admin or survey permission)
router.post('/templates/:id/questions', requireCap('survey.manage'), SurveyController.addQuestion)
router.post('/templates/:id/questions/reorder', requireCap('survey.manage'), SurveyController.reorderQuestions)
router.put('/questions/:questionId', requireCap('survey.manage'), SurveyController.updateQuestion)
router.delete('/questions/:questionId', requireCap('survey.manage'), SurveyController.deleteQuestion)

export default router
