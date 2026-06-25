# -----------------------------------------------------------------------------
# Single S3 website bucket for every app's static pages.
#
# Each app owns a top-level prefix:
#   http://<bucket>.s3-website.<region>.amazonaws.com/<app>/<file>
#
# Source files should live in each app directory under <app>/docs/.
# Add or remove entries in local.pages as apps are added to the monorepo.
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "web" {
  bucket = var.bucket_name

  tags = {
    Project = var.project
  }
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_website_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket     = aws_s3_bucket.web.id
  depends_on = [aws_s3_bucket_public_access_block.web]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicRead"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.web.arn}/*"
      },
    ]
  })
}

locals {
  # Example:
  #
  # "my-app/index.html" = {
  #   source       = "${path.module}/../../games/my-app/docs/index.html"
  #   content_type = "text/html; charset=utf-8"
  # }
  # "my-app/privacy.html" = {
  #   source       = "${path.module}/../../games/my-app/docs/privacy.html"
  #   content_type = "text/html; charset=utf-8"
  # }
  pages = {}
}

resource "aws_s3_object" "pages" {
  for_each = local.pages

  bucket       = aws_s3_bucket.web.id
  key          = each.key
  source       = each.value.source
  content_type = each.value.content_type
  etag         = filemd5(each.value.source)
}
