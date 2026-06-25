output "website_endpoint" {
  value       = aws_s3_bucket_website_configuration.web.website_endpoint
  description = "S3 website endpoint for app static pages."
}

output "website_root_url" {
  value       = "http://${aws_s3_bucket_website_configuration.web.website_endpoint}/"
  description = "Root URL for this monorepo's static app pages."
}

