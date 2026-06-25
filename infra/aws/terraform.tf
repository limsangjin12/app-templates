terraform {
  required_version = ">= 1.5.0"

  # Optional HCP Terraform backend. Uncomment and customize if the project uses it.
  #
  # cloud {
  #   organization = "your-terraform-org"
  #
  #   workspaces {
  #     name = "apps-web"
  #   }
  # }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

