variable "aws_region" {
  description = "AWS region for the S3 bucket."
  type        = string
  default     = "ap-northeast-2"
}

variable "aws_profile" {
  description = "Named AWS CLI profile used for local Terraform execution."
  type        = string
  default     = "default"
}

variable "bucket_name" {
  description = "Globally unique S3 bucket name hosting all app static pages."
  type        = string
}

variable "project" {
  description = "Tag applied to managed resources."
  type        = string
  default     = "apps-web"
}

