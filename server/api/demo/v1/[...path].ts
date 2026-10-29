import { defineEventHandler } from 'h3'
import { handleDemoRequest } from '../../../utils/demo/http'

export default defineEventHandler(handleDemoRequest)
